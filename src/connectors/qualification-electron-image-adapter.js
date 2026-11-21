"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createElectronQualificationImageAdapter = createElectronQualificationImageAdapter;
function createElectronQualificationImageAdapter(input) {
    return {
        async inspect(bytes) {
            const native = input.createNativeImage(bytes);
            if (!native.isEmpty())
                return validateDimensions(native.getSize());
            const decoded = await input.decodeInRenderer(bytes);
            return validateDimensions(decoded);
        },
        async toJpeg(bytes, quality) {
            const native = input.createNativeImage(bytes);
            if (!native.isEmpty())
                return validateJpeg(native.toJPEG(quality));
            const decoded = await input.decodeInRenderer(bytes, quality);
            validateDimensions(decoded);
            if (!decoded.jpegBytes)
                throw new Error('Qualification image conversion failed');
            return validateJpeg(decoded.jpegBytes);
        },
        async toThumbnail(bytes, maxDimension, quality) {
            const native = input.createNativeImage(bytes);
            if (!native.isEmpty() && native.resize) {
                const size = validateDimensions(native.getSize());
                const scale = Math.min(1, maxDimension / Math.max(size.width, size.height));
                const width = Math.max(1, Math.round(size.width * scale));
                const height = Math.max(1, Math.round(size.height * scale));
                return validateJpeg(native.resize({ width, height, quality: 'good' }).toJPEG(quality));
            }
            if (!native.isEmpty())
                return validateJpeg(native.toJPEG(quality));
            const decoded = await input.decodeInRenderer(bytes, quality, maxDimension);
            validateDimensions(decoded);
            if (!decoded.jpegBytes)
                throw new Error('Qualification image conversion failed');
            return validateJpeg(decoded.jpegBytes);
        }
    };
}
function validateDimensions(value) {
    if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width <= 0 || value.height <= 0) {
        throw new Error('Qualification image is unreadable');
    }
    return { width: value.width, height: value.height };
}
function validateJpeg(value) {
    const bytes = Buffer.from(value);
    if (bytes.byteLength <= 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw new Error('Qualification image conversion failed');
    }
    return bytes;
}
