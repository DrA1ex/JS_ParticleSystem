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
    const url = URL.createObjectURL(file);
    a.href = url;
    a.download = fileName;
    a.click();

    setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 0);
}
