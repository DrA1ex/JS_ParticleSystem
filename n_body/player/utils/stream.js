export class ObservableStreamLoader {

    /**
     * @param asyncReader
     * @param {function(read: number, total: number)} progressFn
     */
    constructor(asyncReader, progressFn) {
        this.stream = asyncReader;
        this.progressFn = progressFn;
    }

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
        this.size = response.headers.get('Content-Length');

        if (this.size <= 0) {
            throw new Error("Unsupported server response: required Content-Length header");
        }
    }

    async* [Symbol.asyncIterator]() {
        const reader = this.response.body.getReader()

        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }

            yield chunk.value;
        }
    }
}