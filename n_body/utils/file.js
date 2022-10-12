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

        input.onchange = () => {
            const files = Array.from(input.files || []);
            if (multiple) {
                resolve(files);
            } else {
                resolve(files[0]);
            }

            input.remove();
        };

        input.click();
    });
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
    const a = document.createElement("a");
    const file = new Blob(parts, {type: contentType});
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();

    setTimeout(() => a.remove(), 0);
}
