"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withInternalPurchaseBackgroundInput = withInternalPurchaseBackgroundInput;
exports.buildInternalPurchaseProtocolInput = buildInternalPurchaseProtocolInput;
exports.sendInternalPurchaseInput = sendInternalPurchaseInput;
exports.insertInternalPurchaseText = insertInternalPurchaseText;
const sessions = new WeakMap();
async function command(target, method, params) {
    let timer;
    try {
        await Promise.race([
            target.debugger.sendCommand(method, params),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`后台页面输入响应超时：${method}；为避免重复操作，已停止本次任务`)), 10_000);
            })
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
/** Scoped to the seller webContents; never focuses an OS window or moves its cursor. */
async function withInternalPurchaseBackgroundInput(target, operation) {
    let session = sessions.get(target);
    if (!session) {
        if (target.isDestroyed())
            throw new Error('淘宝页面已关闭');
        const ownsDebugger = !target.debugger.isAttached();
        if (ownsDebugger)
            target.debugger.attach('1.3');
        session = {
            ownsDebugger,
            leases: 0,
            ready: command(target, 'Emulation.setFocusEmulationEnabled', { enabled: true })
        };
        sessions.set(target, session);
    }
    session.leases += 1;
    try {
        await session.ready;
        return await operation();
    }
    finally {
        if (--session.leases === 0) {
            sessions.delete(target);
            if (!target.isDestroyed() && target.debugger.isAttached()) {
                await command(target, 'Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined);
                if (session.ownsDebugger && target.debugger.isAttached())
                    target.debugger.detach();
            }
        }
    }
}
function modifiersFor(input) {
    const modifiers = input.modifiers ?? [];
    return (modifiers.includes('alt') ? 1 : 0)
        | (modifiers.includes('control') ? 2 : 0)
        | (modifiers.includes('meta') ? 4 : 0)
        | (modifiers.includes('shift') ? 8 : 0);
}
function buildInternalPurchaseProtocolInput(input) {
    const modifiers = modifiersFor(input);
    if (input.type.startsWith('mouse')) {
        const types = { mouseMove: 'mouseMoved', mouseDown: 'mousePressed', mouseUp: 'mouseReleased', mouseWheel: 'mouseWheel' };
        return {
            method: 'Input.dispatchMouseEvent',
            params: {
                type: types[input.type],
                x: input.x, y: input.y, modifiers,
                button: input.button ?? 'none',
                ...(input.clickCount !== undefined ? { clickCount: input.clickCount } : {}),
                // Electron wheel deltas have the opposite sign to the Chromium protocol.
                ...(input.type === 'mouseWheel' ? { deltaX: -(input.deltaX ?? 0), deltaY: -(input.deltaY ?? 0) } : {})
            }
        };
    }
    const suppliedKey = input.keyCode ?? '';
    const namedKeys = {
        ENTER: ['Enter', 'Enter', 13], SPACE: [' ', 'Space', 32], TAB: ['Tab', 'Tab', 9],
        ESCAPE: ['Escape', 'Escape', 27], BACKSPACE: ['Backspace', 'Backspace', 8],
        HOME: ['Home', 'Home', 36], END: ['End', 'End', 35]
    };
    const punctuationKeys = {
        ' ': ['Space', 32], '-': ['Minus', 189], '.': ['Period', 190],
        ':': ['Semicolon', 186], '/': ['Slash', 191], ',': ['Comma', 188],
        ';': ['Semicolon', 186], '=': ['Equal', 187], '_': ['Minus', 189],
        '+': ['Equal', 187]
    };
    const [key, code, virtualKey] = namedKeys[suppliedKey.toUpperCase()] ?? [
        suppliedKey,
        /^[a-z]$/iu.test(suppliedKey) ? `Key${suppliedKey.toUpperCase()}` : /^\d$/u.test(suppliedKey) ? `Digit${suppliedKey}` : punctuationKeys[suppliedKey]?.[0] ?? '',
        /^[a-z0-9]$/iu.test(suppliedKey) ? suppliedKey.toUpperCase().charCodeAt(0) : punctuationKeys[suppliedKey]?.[1] ?? 0
    ];
    // Literal characters already have a following char event in the connector.
    // Only named activation keys synthesize text on keyDown.
    const text = input.type === 'char' ? suppliedKey : suppliedKey.toUpperCase() === 'ENTER' ? '\r' : suppliedKey.toUpperCase() === 'SPACE' ? ' ' : undefined;
    return {
        method: 'Input.dispatchKeyEvent',
        params: {
            type: input.type === 'char' ? 'char' : input.type === 'keyUp' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
            key, code, modifiers, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey,
            ...(input.type !== 'keyUp' && text !== undefined ? { text, unmodifiedText: text } : {})
        }
    };
}
async function sendInternalPurchaseInput(target, input) {
    const { method, params } = buildInternalPurchaseProtocolInput(input);
    await withInternalPurchaseBackgroundInput(target, async () => {
        if (target.isDestroyed())
            throw new Error('淘宝页面已关闭');
        // Do not replay uncertain input: a timed-out mouse release may have submitted.
        await command(target, method, params);
    });
}
async function insertInternalPurchaseText(target, value) {
    await withInternalPurchaseBackgroundInput(target, async () => {
        await command(target, 'Input.insertText', { text: value });
    });
}
