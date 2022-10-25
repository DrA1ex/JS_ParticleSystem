export class SimulationSerializer {
    static META_SIZE = 6;
    static VERSION = 1;
    static COMPONENTS_COUNT = 2;

    /**
     * @param {ChunkedArrayBuffer} buffer
     * @returns {{frames: Float32Array[], meta: {framesCount: number, metaLength: number, componentsCount: number, recordedRate: number, particleCount: number}}}
     */
    static loadData(buffer) {
        const meta = SimulationSerializer._parseMeta(buffer);

        const metaBytes = meta.metaLength * Uint32Array.BYTES_PER_ELEMENT
        const frameSize = meta.particleCount * meta.componentsCount;
        const totalDataBytes = meta.framesCount * frameSize * Float32Array.BYTES_PER_ELEMENT;
        const expectedBytes = totalDataBytes + metaBytes;
        if (expectedBytes > buffer.byteLength) {
            throw new Error(`Invalid size. Expected: ${expectedBytes} got: ${buffer.byteLength}`);
        }

        const frames = new Array(meta.framesCount);
        const framesView = buffer.slice(metaBytes, totalDataBytes);
        for (let i = 0; i < meta.framesCount; i++) {
            const offset = i * frameSize;
            frames[i] = framesView.createTypedArray(Float32Array, offset * Float32Array.BYTES_PER_ELEMENT, frameSize);
        }

        return {
            frames,
            meta,
        };
    }

    static _parseMeta(buffer) {
        const metaBuffer = buffer.createTypedArray(Uint32Array, 0, this.META_SIZE);
        const metaLength = metaBuffer[0];

        const version = metaBuffer[1];
        if (version !== this.VERSION || metaLength < this.META_SIZE) {
            throw new Error(`Unsupported version or invalid header. Version: ${version}`);
        }

        let idx = 2;
        const recordedRate = metaBuffer[idx++];
        const framesCount = metaBuffer[idx++];
        const particleCount = metaBuffer[idx++];
        const componentsCount = metaBuffer[idx++];

        return {
            metaLength,
            recordedRate,
            framesCount,
            particleCount,
            componentsCount
        }
    }

    /**
     * @param {SimulationSequence} sequence
     * @return {Uint32Array}
     */
    static formatMeta(sequence) {
        const meta = new Uint32Array(SimulationSerializer.META_SIZE)
        meta[0] = SimulationSerializer.META_SIZE;
        meta[1] = SimulationSerializer.VERSION;
        meta[2] = sequence.fps;
        meta[3] = sequence.length;
        meta[4] = sequence.particleCount;
        meta[5] = SimulationSerializer.COMPONENTS_COUNT;
        return meta;
    }
}