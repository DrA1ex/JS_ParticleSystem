/**
 * @param {string} contentType
 * @param {boolean} multiple
 * @return {Promise<*>}
 */
export function openFile(contentType, multiple) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = multiple;
        input.accept = contentType;

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            input.remove();
            resolve(value);
        };

        input.onchange = () => {
            const files = Array.from(input.files || []);
            finish(multiple ? files : (files[0] || null));
        };
        input.oncancel = () => finish(multiple ? [] : null);

        input.click();
    });
}


/**
 * Download an already constructed Blob without rebuilding its contents.
 * @param {Blob} blob
 * @param {string} fileName
 */
export function saveBlob(blob, fileName) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();

    // Keep the object URL alive long enough for browsers to start streaming
    // very large files instead of revoking it in the same event turn.
    setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 60_000);
}

/**
 *
 * @param {*} content
 * @param {string} fileName
 * @param {string} contentType
 */
export function saveFile(content, fileName, contentType) {
    return saveFileParts([content], fileName, contentType);
}

/**
 * @param {*[]} parts
 * @param {string} fileName
 * @param {string} contentType
 */
export function saveFileParts(parts, fileName, contentType) {
    return saveBlob(new Blob(parts, {type: contentType}), fileName);
}
