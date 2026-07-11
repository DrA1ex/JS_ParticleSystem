export const COLLISION_MIN_CLOSING_SPEED_SQ = 1e-10;

export function collisionMinDistanceSq(collisionSizeSq) {
    return Math.max(1e-12, collisionSizeSq * 1e-10);
}

/**
 * Return the multiplier to apply to the accumulated collision delta.
 *
 * Dense-contact stabilization is deliberately split into independent switches:
 * - averageContacts prevents the response from growing with neighbour count;
 * - limitImpulse caps the final response by the fastest measured closing speed.
 *
 * Keeping these choices outside the hot pair loop makes it possible to compare
 * more energetic collision behaviour without reverting the correctness fixes
 * that ignore already separating pairs and apply restitution inside the impulse.
 */
export function collisionDeltaScale(
    deltaVelX,
    deltaVelY,
    contactCount,
    maxClosingSpeed,
    restitution,
    averageContacts = true,
    limitImpulse = true,
) {
    if (contactCount <= 0) {
        return 0;
    }

    let scale = averageContacts ? 1 / contactCount : 1;
    if (!limitImpulse) {
        return scale;
    }

    const responseLength = Math.hypot(deltaVelX * scale, deltaVelY * scale);
    const maxDelta = Math.max(0, (1 + restitution) * maxClosingSpeed);
    if (maxDelta > 0 && responseLength > maxDelta) {
        scale *= maxDelta / responseLength;
    }
    return scale;
}
