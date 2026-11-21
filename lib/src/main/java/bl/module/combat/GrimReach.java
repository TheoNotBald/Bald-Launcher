package bl.module.combat;

/**
 * The reach distance GrimAC accepts, derived from its combat Reach check.
 *
 * <p>Grim measures the eye-to-box distance itself, against its own copy of the
 * target's hitbox and its own {@code ENTITY_INTERACTION_RANGE} attribute (3.0).
 * Raising the attribute in the client only widens our own crosshair raycast; it
 * never reaches Grim's numbers. Before comparing, Grim expands the target box by
 * {@code Reach.threshold} (0.0005) plus the 0.03 movement threshold, and an
 * axis-aligned distance to a box shrinks by exactly that expansion, so the server
 * accepts up to {@code 3.0 + 0.0305}. That is the whole budget: a hit beyond it is
 * a reach flag, and no packet can enlarge it.</p>
 */
final class GrimReach {

    /** Vanilla {@code ENTITY_INTERACTION_RANGE}, which Grim uses as {@code maxReach}. */
    static final double SERVER_RANGE = 3.0;

    /** Grim's default {@code Reach.threshold} plus the movement threshold it adds to the box. */
    static final double HITBOX_MARGIN = 0.0305;

    /** Keeps us off the exact flag boundary, where rounding and a tick of drift decide. */
    static final double SAFETY = 0.005;

    /** Largest eye-to-hitbox distance Grim accepts, minus the safety margin. */
    static final double LIMIT = SERVER_RANGE + HITBOX_MARGIN - SAFETY;

    private GrimReach() {
    }

    /** Squared distance from a point to an axis-aligned box; zero when the point is inside. */
    static double distanceSquaredToBox(double minX, double minY, double minZ,
            double maxX, double maxY, double maxZ, double x, double y, double z) {
        double dx = Math.max(Math.max(minX - x, x - maxX), 0.0);
        double dy = Math.max(Math.max(minY - y, y - maxY), 0.0);
        double dz = Math.max(Math.max(minZ - z, z - maxZ), 0.0);
        return dx * dx + dy * dy + dz * dz;
    }

    /**
     * True when an attack from {@code (x, eyeY, z)} is inside Grim's budget.
     * Unreadable geometry rejects, because an unknown distance must not be sent.
     */
    static boolean withinLimit(double minX, double minY, double minZ,
            double maxX, double maxY, double maxZ, double x, double y, double z) {
        if (!Double.isFinite(minX) || !Double.isFinite(minY) || !Double.isFinite(minZ)
                || !Double.isFinite(maxX) || !Double.isFinite(maxY) || !Double.isFinite(maxZ)
                || !Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
            return false;
        }
        return distanceSquaredToBox(minX, minY, minZ, maxX, maxY, maxZ, x, y, z) <= LIMIT * LIMIT;
    }
}
