export function* range(from, to, step = 1) {
    for (let i = from; i < to; i += step) {
        yield i;
    }
}