

int getOreVeinStrengthAt(int x, int y, int z, OreVeinParameters* params, double* strength)
{
    static const OreVeinConfig
    ov_copper = {COPPER_ORE, RAW_COPPER_BLOCK, GRANITE, 0, 50},
    ov_iron = {IRON_ORE, RAW_IRON_BLOCK, TUFF, -60, -8};
    static const int min_y = MIN(0 /*ov_copper.minY*/, -60 /*ov_iron.minY*/);
    static const int max_y = MAX(50 /*ov_copper.maxY*/, -8 /*ov_iron.maxY*/);

    if (strength)
        *strength = 0.0;
    if (y < min_y || y > max_y)
        return -1;

    double veinToggleSample = sampleDoublePerlin(&params->oreVeininess, x * 1.5, y * 1.5, z * 1.5);
    int oreType = veinToggleSample > 0.0 ? CopperVein : IronVein;
    OreVeinConfig ovconf = veinToggleSample > 0.0 ? ov_copper : ov_iron;

    int belowTop = ovconf.maxY - y;
    int aboveBottom = y - ovconf.minY;
    if (aboveBottom < 0 || belowTop < 0)
        return -1;
    int offset = MIN(belowTop, aboveBottom);

    double eff = fabs(veinToggleSample) + clampedMap(offset, 0.0, 20.0, -0.2, 0.0);
    if (strength)
        *strength = eff;
    if (eff < 0.4F)
        return -1;
    return oreType;
}
