export const COLLISION_MIN_CLOSING_SPEED_SQ = 1e-10;

export function collisionMinDistanceSq(collisionSizeSq) {
    return Math.max(1e-12, collisionSizeSq * 1e-10);
}

/**
 * Deterministic antisymmetric normal for particles whose positions are too
 * close to normalize safely. The reverse pair receives the opposite normal.
 * This lets overlap separation resolve exact/coincident particles instead of
 * silently leaving them stuck. This path is intentionally rare.
 */
export function collisionFallbackNormal(indexA, indexB) {
    const low = Math.min(indexA, indexB) >>> 0;
    const high = Math.max(indexA, indexB) >>> 0;
    let hash = (Math.imul(low + 1, 0x9e3779b1) ^ Math.imul(high + 1, 0x85ebca6b)) >>> 0;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d) >>> 0;
    hash ^= hash >>> 15;
    const angle = (hash / 0x100000000) * Math.PI * 2;
    let nx = Math.cos(angle);
    let ny = Math.sin(angle);
    if (indexA > indexB) {
        nx = -nx;
        ny = -ny;
    }
    return [nx, ny];
}

export function collisionContactScale(contactCount, contactMode) {
    if (contactCount <= 0) return 0;
    switch (contactMode) {
        case "full":
            return 1;
        case "average":
            return 1 / contactCount;
        case "balanced":
        default:
            return 1 / Math.sqrt(contactCount);
    }
}

/**
 * Scale an accumulated Jacobi collision response.
 *
 * `balanced` uses RMS-style normalization: stronger than strict averaging but
 * bounded enough for dense leaves. The optional cap uses the root-sum-square
 * magnitude of the individual pair responses, rather than the fastest single
 * closing contact. This avoids the old interaction where averaging + a tight
 * max-contact cap removed almost all pressure from a cluster.
 */
export function collisionDeltaScale(
    deltaVelX,
    deltaVelY,
    contactCount,
    impulseSquareSum,
    contactMode = "balanced",
    limitImpulse = true,
) {
    let scale = collisionContactScale(contactCount, contactMode);
    if (scale === 0 || !limitImpulse || impulseSquareSum <= 0) {
        return scale;
    }

    const responseLength = Math.hypot(deltaVelX * scale, deltaVelY * scale);
    const maxDelta = Math.sqrt(impulseSquareSum);
    if (responseLength > maxDelta) {
        scale *= maxDelta / responseLength;
    }
    return scale;
}

export function collisionContactModeCode(contactMode) {
    switch (contactMode) {
        case "full": return 0;
        case "average": return 2;
        case "balanced":
        default: return 1;
    }
}
