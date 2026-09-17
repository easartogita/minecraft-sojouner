
/**
 * Get the deterministic ore-vein field at a position, rather than the resolved
 * block as in getOreVeinBlockAt. Reports which vein a position belongs to and how
 * strongly, without the ridged-shape mask or the per-block random thinning, so it
 * is deterministic across a position's neighbourhood and suited to area/column/
 * overlay queries.
 *
 * @param x the block X-coordinate
 * @param y the block Y-coordinate
 * @param z the block Z-coordinate
 * @param params the ore vein parameters from initOreVeinNoise (MC >= 1.18)
 * @param strength if non-NULL, receives fabs(veininess) adjusted by the vertical
 *        edge falloff, the quantity getOreVeinBlockAt thresholds at 0.4F: a
 *        position belongs to a vein when *strength >= 0.4F, and the magnitude
 *        above 0.4 tracks ore density. Written even when the return is -1, as long
 *        as the position is within the vein Y band, so callers can gauge proximity
 * @return the vein type as listed in OreVeins (CopperVein or IronVein), or -1 when
 *         the position is outside any vein band or below the 0.4F threshold
 */
int getOreVeinStrengthAt(int x, int y, int z, OreVeinParameters* params, double* strength);
