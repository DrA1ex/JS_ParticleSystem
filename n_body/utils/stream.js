import {ChunkedArrayBuffer} from "./array_buffer.js";

export class ObservableStreamLoader {
    static CHUCK_SIZE = 1024 * 1024 * 64;

    /**
     * @param asyncReader
     * @param {function(read: number, total: number)} progressFn
     */
    constructor(asyncReader, progressFn) {
        this.stream = asyncReader;
        this.progressFn = progressFn;
    }

    /**
     * @return {Promise<ArrayBuffer>}
     */
    async load() {
        const size = this.stream.size;
        const data = new Uint8Array(size);

        this.progressFn(0, size);

        let offset = 0;
        for await (const chunk of this.stream) {
            data.set(chunk, offset);
            offset += chunk.length;

            this.progressFn(offset, size);
        }

        return data.buffer;
    }

    /**
     * @param {number} [chunkSize=ObservableStreamLoader.CHUCK_SIZE]
     * @return {Promise<ChunkedArrayBuffer>}
     */
    async loadChunked(chunkSize = ObservableStreamLoader.CHUCK_SIZE) {
        const totalSize = this.stream.size;
        this.progressFn(0, totalSize);

        const bigChunks = [];
        let totalRead = 0;
        let read = 0;
        let readChunks = [];
        for await (const chunk of this.stream) {
            readChunks.push(chunk.buffer)
            read += chunk.length;
            totalRead += chunk.length;
            if (read >= chunkSize) {
                bigChunks.push(new ChunkedArrayBuffer(readChunks).toTypedArray(Uint8Array).buffer);
                readChunks = [];
                read = 0;
            }

            this.progressFn(totalRead, totalSize);
        }

        if (readChunks.length > 0) {
            bigChunks.push(new ChunkedArrayBuffer(readChunks).toTypedArray(Uint8Array).buffer);
            this.progressFn(totalSize, totalSize);
        }

        return new ChunkedArrayBuffer(bigChunks);
    }
}

export class FileAsyncReader {
    constructor(file) {
        this.file = file;
        this.size = file.size;
    }

    async* [Symbol.asyncIterator]() {
        const reader = this.file.stream().getReader()

        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }

            yield chunk.value;
        }
    }
}

export class FetchDataAsyncReader {
    constructor(response) {
        this.response = response;
        this.size = response.headers.get('Content-Length') ?? -1;
    }

    async* [Symbol.asyncIterator]() {
        const reader = this.response.body.getReader();
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }

            yield chunk.value;
        }
    }
}