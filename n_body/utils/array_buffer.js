/**
 * @typedef {{buffer: ArrayBuffer, start: number, end: number, size: number}} Chunk
 * @typedef {Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array} TypedArray
 */

export class ChunkedArrayBuffer {
    /** @type {Chunk[]} */
    chunks = [];
    bytesOffset = 0;
    byteLength = 0;

    /**
     * @param {ArrayBuffer[]} chunks
     * @param {number} [bytesOffset=0]
     * @param {number} [byteLength=-1]
     */
    constructor(chunks, bytesOffset = 0, byteLength = -1) {
        for (const chunk of chunks) {
            this._addChunk(chunk);
        }

        const totalBytes = this.byteLength;
        this.bytesOffset = Math.max(0, Math.min(bytesOffset, totalBytes));
        const requestedLength = byteLength >= 0 ? byteLength : totalBytes - this.bytesOffset;
        this.byteLength = Math.max(0, Math.min(totalBytes - this.bytesOffset, requestedLength));
    }

    /**
     * @param {ArrayBuffer} chunk
     */
    _addChunk(chunk) {
        if (chunk.byteLength === 0) {
            return;
        }

        const lastOffset = this.byteLength;
        this.chunks.push({
            buffer: chunk,
            start: lastOffset,
            end: lastOffset + chunk.byteLength,
            size: chunk.byteLength
        });

        this.byteLength += chunk.byteLength;
    }

    /**
     * @param {number} bytesOffset
     * @param {number} byteLength
     * @return {ChunkedArrayBuffer}
     */
    slice(bytesOffset, byteLength) {
        const relativeStart = Math.max(0, Math.min(bytesOffset, this.byteLength));
        const requestedLength = Math.max(0, byteLength);
        const length = Math.min(requestedLength, this.byteLength - relativeStart);
        if (length === 0) {
            return new ChunkedArrayBuffer([], 0, 0);
        }

        const startBorder = this.bytesOffset + relativeStart;
        const endBorder = startBorder + length;
        const chunks = this.chunks.filter(c => startBorder < c.end && endBorder > c.start);

        if (chunks.length > 0) {
            return new ChunkedArrayBuffer(
                chunks.map(c => c.buffer),
                startBorder - chunks[0].start,
                length
            );
        }

        return new ChunkedArrayBuffer([], 0, 0);
    }

    /**
     * @template {TypedArray} Type
     *
     * @param type
     * @param {number} [bytesOffset=0]
     * @param {number} [count=-1]
     * @returns {Type}
     */
    createTypedArray(type, bytesOffset = 0, count = -1) {
        const itemSize = type.BYTES_PER_ELEMENT;
        const totalSize = count > 0 ? count : Math.floor((this.byteLength - bytesOffset) / itemSize);
        return this.slice(bytesOffset, totalSize * itemSize).toTypedArray(type);
    }

    /**
     * @template {TypedArray} Type
     *
     * @param type
     * @returns {Type}
     */
    toTypedArray(type) {
        const itemSize = type.BYTES_PER_ELEMENT;
        if (this.chunks.length === 0 || this.byteLength < itemSize) {
            return new type();
        }

        const itemsCount = Math.floor(this.byteLength / itemSize);
        if (this.chunks.length === 1 && this.bytesOffset % itemSize === 0) {
            const {buffer} = this.chunks[0];
            return new type(buffer, this.bytesOffset, itemsCount);
        }

        const result = new Uint8Array(itemsCount * itemSize);

        let remaining = result.length;
        let written = 0;
        for (let i = 0; i < this.chunks.length && remaining > 0; i++) {
            const {buffer, size} = this.chunks[i];
            const chunkBytes = new Uint8Array(buffer);

            const offset = i === 0 ? this.bytesOffset : 0;
            const copyLength = Math.min(remaining, size - offset);

            result.set(chunkBytes.subarray(offset, offset + copyLength), written);

            written += copyLength;
            remaining -= copyLength;
        }

        return new type(result.buffer);
    }
}