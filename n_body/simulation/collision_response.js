export const COLLISION_MIN_CLOSING_SPEED_SQ = 1e-10;

export function collisionMinDistanceSq(collisionSizeSq) {
    return Math.max(1e-12, collisionSizeSq * 1e-10);
}

/**
 * Return the multiplier to apply to the accumulated collision delta.
 * Dense leaves may contain many simultaneous and conflicting contacts, so the
 * Jacobi impulses are averaged instead of growing with neighbour count. The
 * result is also capped by the fastest measured closing speed, which preserves
 * isolated two-body collisions while preventing crowded leaves from injecting
 * large velocity spikes.
 */
export function collisionDeltaScale(deltaVelX, deltaVelY, contactCount, maxClosingSpeed, restitution) {
    if (contactCount <= 0) {
        return 0;
    }

    let scale = 1 / contactCount;
    const averagedLength = Math.hypot(deltaVelX * scale, deltaVelY * scale);
    const maxDelta = Math.max(0, (1 + restitution) * maxClosingSpeed);
    if (maxDelta > 0 && averagedLength > maxDelta) {
        scale *= maxDelta / averagedLength;
    }
    return scale;
}
