export function findKey(type, value) {
    for (const [key, enumValue] of Object.entries(type)) {
        if (enumValue === value) {
            return key;
        }
    }

    return null;
}