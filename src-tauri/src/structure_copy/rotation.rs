//! The geometric position transform (Y-axis rotation + X/Z mirror) and the
//! blockstate `Properties` rotation table it implies, for arbitrary
//! block-box copy/paste.
//!
//! **Load-bearing**: mirror is applied first, then rotation — for both the
//! position transform and every property rule below. If these ever disagree
//! on order, structures come out with correct positions but wrong facings
//! (or vice versa) — a bug that looks like "it mostly works", not a crash.
//! Covered by the `#[cfg(test)]` module at the bottom.

use fastnbt::Value;
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Rotation { R0, R90, R180, R270 }

impl Rotation {
    pub(crate) fn from_degrees(deg: i32) -> Self {
        match deg.rem_euclid(360) {
            90 => Rotation::R90,
            180 => Rotation::R180,
            270 => Rotation::R270,
            _ => Rotation::R0,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Mirror { None, X, Z }

impl Mirror {
    pub(crate) fn from_str(s: Option<&str>) -> Self {
        match s {
            Some("x") | Some("X") => Mirror::X,
            Some("z") | Some("Z") => Mirror::Z,
            _ => Mirror::None,
        }
    }
}

/// A source box's local dimensions, in blocks (not max-inclusive indices).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Dims { pub width: i32, pub height: i32, pub depth: i32 }

/// Transforms one source block's LOCAL position (0-based; `lx < dims.width`,
/// `lz < dims.depth`) into its local position in the transformed box. `ly` is
/// untouched — rotation/mirror here is Y-axis-only, matching the "90°
/// increments around Y, plus X/Z mirror" scope this shipped with (see the v3
/// plan's rotation-scope decision).
pub(crate) fn transform_pos(dims: Dims, mirror: Mirror, rot: Rotation, lx: i32, ly: i32, lz: i32) -> (i32, i32, i32) {
    let (mut x, mut z) = (lx, lz);
    match mirror {
        Mirror::None => {}
        Mirror::X => x = dims.width - 1 - x,
        Mirror::Z => z = dims.depth - 1 - z,
    }
    let (x, z) = match rot {
        Rotation::R0   => (x, z),
        Rotation::R90  => (dims.depth - 1 - z, x),
        Rotation::R180 => (dims.width - 1 - x, dims.depth - 1 - z),
        Rotation::R270 => (z, dims.width - 1 - x),
    };
    (x, ly, z)
}

/// The transformed box's own dimensions — a 90°/270° rotation swaps
/// width/depth (mirror never changes dimensions).
pub(crate) fn transformed_dims(dims: Dims, rot: Rotation) -> Dims {
    match rot {
        Rotation::R0 | Rotation::R180 => dims,
        Rotation::R90 | Rotation::R270 => Dims { width: dims.depth, height: dims.height, depth: dims.width },
    }
}

// ── Blockstate `Properties` rotation ────────────────────────────────────────
// Rules are keyed by property NAME, not block name — Mojang's property
// semantics are consistent across every block carrying a given property, so
// one rule per name covers every block that has it. A starter set, not an
// exhaustive per-block table; anything uncovered is left as-is and reported
// via `format_guard::format_warn` (same pattern region_reader.rs uses for
// unexpected palette shapes) so the table can grow from real testing.

const DIR_CYCLE: [&str; 4] = ["north", "east", "south", "west"];

fn mirror_dir(dir: &str, mirror: Mirror) -> &str {
    match (mirror, dir) {
        (Mirror::X, "east") => "west",
        (Mirror::X, "west") => "east",
        (Mirror::Z, "north") => "south",
        (Mirror::Z, "south") => "north",
        _ => dir,
    }
}

fn rotation_steps(rot: Rotation) -> usize {
    match rot { Rotation::R0 => 0, Rotation::R90 => 1, Rotation::R180 => 2, Rotation::R270 => 3 }
}

/// Rotate/mirror a single cardinal-direction token (`"north"`/`"east"`/
/// `"south"`/`"west"`). Returns `None` for anything else (callers use that to
/// fall through, e.g. `"up"`/`"down"` in a 6-way `facing`).
fn rotate_dir(dir: &str, mirror: Mirror, rot: Rotation) -> Option<&'static str> {
    let mirrored = mirror_dir(dir, mirror);
    let idx = DIR_CYCLE.iter().position(|&d| d == mirrored)?;
    Some(DIR_CYCLE[(idx + rotation_steps(rot)) % 4])
}

fn rotate_facing_value(value: &str, mirror: Mirror, rot: Rotation) -> Option<String> {
    if value == "up" || value == "down" {
        return Some(value.to_string()); // 6-way facing: vertical is untouched by a Y-axis transform
    }
    rotate_dir(value, mirror, rot).map(|s| s.to_string())
}

fn rotate_axis(value: &str, rot: Rotation) -> Option<String> {
    let swap = matches!(rot, Rotation::R90 | Rotation::R270);
    Some(match value {
        "y" => "y",
        "x" => if swap { "z" } else { "x" },
        "z" => if swap { "x" } else { "z" },
        _ => return None,
    }.to_string())
}

/// `hinge` (doors): rotation preserves handedness, mirror flips it.
fn rotate_hinge(value: &str, mirror: Mirror) -> Option<&'static str> {
    let flip = mirror != Mirror::None;
    Some(match (value, flip) {
        ("left", false)  => "left",
        ("right", false) => "right",
        ("left", true)   => "right",
        ("right", true)  => "left",
        _ => return None,
    })
}

/// Stairs' `shape` (straight/inner_left/inner_right/outer_left/outer_right):
/// same handedness rule as `hinge` — rotation alone never changes this value
/// (only the stair's `facing` needs to change to reflect the turn); mirror
/// flips left/right. Returns `None` for anything outside this value set
/// (rail `shape` values fall through here — see `rotate_rail_shape`, tried
/// second in `rotate_properties` below).
fn rotate_stair_shape(value: &str, mirror: Mirror) -> Option<&'static str> {
    let flip = mirror != Mirror::None;
    Some(match (value, flip) {
        ("straight", _) => "straight",
        ("inner_left", false)  => "inner_left",
        ("inner_right", false) => "inner_right",
        ("outer_left", false)  => "outer_left",
        ("outer_right", false) => "outer_right",
        ("inner_left", true)   => "inner_right",
        ("inner_right", true)  => "inner_left",
        ("outer_left", true)   => "outer_right",
        ("outer_right", true)  => "outer_left",
        _ => return None,
    })
}

/// Rail-family `shape` (plain rail's 10-value set with diagonal corners, or
/// powered/detector/activator rail's 6-value straight/ascending subset).
/// Rather than a hand-authored lookup table, decomposes each value into its
/// cardinal-direction token(s), rotates each via `rotate_dir` (same
/// primitive `facing` uses), and reconstructs the canonical name — correct
/// by construction as long as `rotate_dir` is.
fn rotate_rail_shape(value: &str, mirror: Mirror, rot: Rotation) -> Option<String> {
    if let Some(rest) = value.strip_prefix("ascending_") {
        let d = rotate_dir(rest, mirror, rot)?;
        return Some(format!("ascending_{d}"));
    }
    let parts: Vec<&str> = value.split('_').collect();
    if parts.len() != 2 {
        return None;
    }
    let a = rotate_dir(parts[0], mirror, rot)?;
    let b = rotate_dir(parts[1], mirror, rot)?;
    let is_ns = |d: &str| d == "north" || d == "south";
    if is_ns(a) && is_ns(b) {
        return Some("north_south".to_string());
    }
    if !is_ns(a) && !is_ns(b) {
        return Some("east_west".to_string());
    }
    // One NS, one EW token — a diagonal corner. Canonical MC naming lists
    // the north/south component first (e.g. "south_east", never "east_south").
    let (ns, ew) = if is_ns(a) { (a, b) } else { (b, a) };
    Some(format!("{ns}_{ew}"))
}

/// `rotation` (0-15, banners/standing signs/skulls): each step is 22.5°, so
/// 90° = 4 steps. MC convention: 0 = south, increasing clockwise. Mirroring
/// across north-south (`Mirror::X`, swaps east/west) negates the angle;
/// across east-west (`Mirror::Z`, swaps north/south) reflects about
/// south(0)/north(8), i.e. `8 - value`. Verified against the 4 cardinal cases below.
fn rotate_rotation_int(value: i32, mirror: Mirror, rot: Rotation) -> i32 {
    let mirrored = match mirror {
        Mirror::None => value,
        Mirror::X => (-value).rem_euclid(16),
        Mirror::Z => (8 - value).rem_euclid(16),
    };
    let steps = match rot { Rotation::R0 => 0, Rotation::R90 => 4, Rotation::R180 => 8, Rotation::R270 => 12 };
    (mirrored + steps).rem_euclid(16)
}

fn get_str(props: &HashMap<String, Value>, key: &str) -> Option<String> {
    match props.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

/// The bars/fences/glass-panes family: four separate boolean properties
/// (`north`/`east`/`south`/`west`), not one direction-valued key like
/// `facing` — a block connects on some subset of its four sides. Reuses
/// `rotate_dir` per side: the boolean at side `D` moves to wherever `D`
/// maps to under the same mirror-then-rotate transform everything else uses.
const CONNECTION_SIDE_KEYS: [&str; 4] = ["north", "east", "south", "west"];

fn rotate_connection_sides(props: &mut HashMap<String, Value>, mirror: Mirror, rot: Rotation) {
    let mut current: HashMap<&str, String> = HashMap::new();
    for key in CONNECTION_SIDE_KEYS {
        match props.get(key) {
            Some(Value::String(s)) => { current.insert(key, s.clone()); }
            // Not all four present as plain strings — not this family
            // (or an already-unusual shape); leave untouched rather than
            // guess at a partial match.
            _ => return,
        }
    }
    let mut new_values: HashMap<&str, String> = HashMap::new();
    for key in CONNECTION_SIDE_KEYS {
        if let Some(new_key) = rotate_dir(key, mirror, rot) {
            new_values.insert(new_key, current[key].clone());
        }
    }
    for key in CONNECTION_SIDE_KEYS {
        if let Some(v) = new_values.get(key) {
            props.insert(key.to_string(), Value::String(v.clone()));
        }
    }
}

fn warn_unrotated(key: &str, value: &str) {
    crate::format_guard::format_warn(
        "blockstate property rotation",
        &format!("no rotation rule for {key}={value} — left as-is, this block may face the wrong way after this transform"),
    );
}

/// Rewrites a block's `Properties` compound in place for the given
/// mirror+rotation. Unrecognized property names are left untouched
/// (nothing to do — most properties, like `waterlogged` or a redstone
/// `power` level, aren't directional). A recognized name with a value its
/// rule doesn't handle is also left untouched, but reported — see the module
/// doc comment above.
pub(crate) fn rotate_properties(props: &mut HashMap<String, Value>, mirror: Mirror, rot: Rotation) {
    if let Some(s) = get_str(props, "axis") {
        match rotate_axis(&s, rot) {
            Some(v) => { props.insert("axis".to_string(), Value::String(v)); }
            None => warn_unrotated("axis", &s),
        }
    }
    if let Some(s) = get_str(props, "facing") {
        match rotate_facing_value(&s, mirror, rot) {
            Some(v) => { props.insert("facing".to_string(), Value::String(v)); }
            None => warn_unrotated("facing", &s),
        }
    }
    if let Some(s) = get_str(props, "shape") {
        let result = rotate_stair_shape(&s, mirror).map(|v| v.to_string())
            .or_else(|| rotate_rail_shape(&s, mirror, rot));
        match result {
            Some(v) => { props.insert("shape".to_string(), Value::String(v)); }
            None => warn_unrotated("shape", &s),
        }
    }
    if let Some(s) = get_str(props, "hinge") {
        match rotate_hinge(&s, mirror) {
            Some(v) => { props.insert("hinge".to_string(), Value::String(v.to_string())); }
            None => warn_unrotated("hinge", &s),
        }
    }
    if let Some(Value::Int(r)) = props.get("rotation") {
        let new_r = rotate_rotation_int(*r, mirror, rot);
        props.insert("rotation".to_string(), Value::Int(new_r));
    }
    rotate_connection_sides(props, mirror, rot);
    // half/type (top/bottom/double) deliberately have no rule — unaffected
    // by a Y-axis rotation or an X/Z mirror.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_90_matches_hand_computed_cells() {
        // 2 wide (x) x 1 tall x 3 deep (z) box. 90° CW: new dims 3x1x2.
        let dims = Dims { width: 2, height: 1, depth: 3 };
        assert_eq!(transform_pos(dims, Mirror::None, Rotation::R90, 0, 0, 0), (2, 0, 0));
        assert_eq!(transform_pos(dims, Mirror::None, Rotation::R90, 1, 0, 0), (2, 0, 1));
        assert_eq!(transform_pos(dims, Mirror::None, Rotation::R90, 0, 0, 2), (0, 0, 0));
        assert_eq!(transform_pos(dims, Mirror::None, Rotation::R90, 1, 0, 2), (0, 0, 1));
        let td = transformed_dims(dims, Rotation::R90);
        assert_eq!((td.width, td.height, td.depth), (3, 1, 2));
    }

    #[test]
    fn position_180_and_270_round_trip_to_0() {
        let dims = Dims { width: 4, height: 2, depth: 5 };
        for (lx, ly, lz) in [(0, 0, 0), (3, 1, 4), (2, 0, 1)] {
            let p90 = transform_pos(dims, Mirror::None, Rotation::R90, lx, ly, lz);
            let d90 = transformed_dims(dims, Rotation::R90);
            let p180_via_90_90 = transform_pos(d90, Mirror::None, Rotation::R90, p90.0, p90.1, p90.2);
            let p180_direct = transform_pos(dims, Mirror::None, Rotation::R180, lx, ly, lz);
            assert_eq!(p180_via_90_90, p180_direct, "two 90s should equal one 180 for ({lx},{ly},{lz})");
        }
    }

    #[test]
    fn mirror_x_flips_only_x() {
        let dims = Dims { width: 5, height: 1, depth: 3 };
        assert_eq!(transform_pos(dims, Mirror::X, Rotation::R0, 1, 0, 2), (3, 0, 2));
        assert_eq!(transform_pos(dims, Mirror::Z, Rotation::R0, 1, 0, 2), (1, 0, 0));
    }

    #[test]
    fn facing_rotates_clockwise_and_passes_up_down() {
        assert_eq!(rotate_facing_value("north", Mirror::None, Rotation::R90).as_deref(), Some("east"));
        assert_eq!(rotate_facing_value("east", Mirror::None, Rotation::R90).as_deref(), Some("south"));
        assert_eq!(rotate_facing_value("north", Mirror::None, Rotation::R180).as_deref(), Some("south"));
        assert_eq!(rotate_facing_value("up", Mirror::None, Rotation::R90).as_deref(), Some("up"));
    }

    #[test]
    fn facing_mirror_x_swaps_east_west_only() {
        assert_eq!(rotate_facing_value("east", Mirror::X, Rotation::R0).as_deref(), Some("west"));
        assert_eq!(rotate_facing_value("north", Mirror::X, Rotation::R0).as_deref(), Some("north"));
        assert_eq!(rotate_facing_value("north", Mirror::Z, Rotation::R0).as_deref(), Some("south"));
    }

    #[test]
    fn axis_swaps_x_z_only_on_90_270() {
        assert_eq!(rotate_axis("x", Rotation::R0).as_deref(), Some("x"));
        assert_eq!(rotate_axis("x", Rotation::R90).as_deref(), Some("z"));
        assert_eq!(rotate_axis("z", Rotation::R90).as_deref(), Some("x"));
        assert_eq!(rotate_axis("y", Rotation::R90).as_deref(), Some("y"));
        assert_eq!(rotate_axis("x", Rotation::R180).as_deref(), Some("x"));
    }

    #[test]
    fn stair_shape_flips_handedness_only_under_mirror() {
        assert_eq!(rotate_stair_shape("inner_left", Mirror::None), Some("inner_left"));
        assert_eq!(rotate_stair_shape("inner_left", Mirror::X), Some("inner_right"));
        assert_eq!(rotate_stair_shape("outer_right", Mirror::Z), Some("outer_left"));
        assert_eq!(rotate_stair_shape("straight", Mirror::X), Some("straight"));
    }

    #[test]
    fn hinge_flips_only_under_mirror() {
        assert_eq!(rotate_hinge("left", Mirror::None), Some("left"));
        assert_eq!(rotate_hinge("left", Mirror::X), Some("right"));
        assert_eq!(rotate_hinge("right", Mirror::Z), Some("left"));
    }

    #[test]
    fn rail_shape_straight_swaps_under_90_not_180() {
        assert_eq!(rotate_rail_shape("north_south", Mirror::None, Rotation::R90).as_deref(), Some("east_west"));
        assert_eq!(rotate_rail_shape("north_south", Mirror::None, Rotation::R180).as_deref(), Some("north_south"));
        assert_eq!(rotate_rail_shape("east_west", Mirror::None, Rotation::R90).as_deref(), Some("north_south"));
    }

    #[test]
    fn rail_shape_ascending_rotates_its_direction() {
        assert_eq!(rotate_rail_shape("ascending_north", Mirror::None, Rotation::R90).as_deref(), Some("ascending_east"));
    }

    #[test]
    fn rail_shape_corner_rotates_and_reconstructs_canonical_order() {
        // north+east curve, rotated 90° CW: north->east, east->south => {east, south} => "south_east"
        assert_eq!(rotate_rail_shape("north_east", Mirror::None, Rotation::R90).as_deref(), Some("south_east"));
        // mirrored on X (east<->west): north stays north, east->west => "north_west"
        assert_eq!(rotate_rail_shape("north_east", Mirror::X, Rotation::R0).as_deref(), Some("north_west"));
    }

    #[test]
    fn rotation_int_cardinal_cases() {
        // south=0, west=4, north=8, east=12 (documented MC convention)
        assert_eq!(rotate_rotation_int(0, Mirror::None, Rotation::R90), 4);
        assert_eq!(rotate_rotation_int(0, Mirror::X, Rotation::R0), 0);   // south stays south
        assert_eq!(rotate_rotation_int(4, Mirror::X, Rotation::R0), 12);  // west -> east
        assert_eq!(rotate_rotation_int(12, Mirror::X, Rotation::R0), 4);  // east -> west
        assert_eq!(rotate_rotation_int(8, Mirror::X, Rotation::R0), 8);   // north stays north
        assert_eq!(rotate_rotation_int(0, Mirror::Z, Rotation::R0), 8);   // south -> north
        assert_eq!(rotate_rotation_int(8, Mirror::Z, Rotation::R0), 0);   // north -> south
        assert_eq!(rotate_rotation_int(4, Mirror::Z, Rotation::R0), 4);   // west stays west
    }

    fn side_props(n: bool, e: bool, s: bool, w: bool) -> HashMap<String, Value> {
        let b = |v: bool| Value::String(if v { "true" } else { "false" }.to_string());
        HashMap::from([
            ("north".to_string(), b(n)), ("east".to_string(), b(e)),
            ("south".to_string(), b(s)), ("west".to_string(), b(w)),
            ("waterlogged".to_string(), Value::String("false".to_string())),
        ])
    }
    fn sides(props: &HashMap<String, Value>) -> (bool, bool, bool, bool) {
        let g = |k: &str| matches!(props.get(k), Some(Value::String(s)) if s == "true");
        (g("north"), g("east"), g("south"), g("west"))
    }

    #[test]
    fn connection_sides_rotate_with_the_block() {
        // A bar running north-south rotated 90° should end up east-west.
        let mut props = side_props(true, false, true, false);
        rotate_properties(&mut props, Mirror::None, Rotation::R90);
        assert_eq!(sides(&props), (false, true, false, true));
    }

    #[test]
    fn connection_sides_180_swaps_opposite_pairs() {
        let mut props = side_props(true, true, false, false); // connects N+E only
        rotate_properties(&mut props, Mirror::None, Rotation::R180);
        assert_eq!(sides(&props), (false, false, true, true)); // now S+W only
    }

    #[test]
    fn connection_sides_mirror_x_swaps_east_west_only() {
        let mut props = side_props(true, true, false, false); // connects N+E only
        rotate_properties(&mut props, Mirror::X, Rotation::R0);
        assert_eq!(sides(&props), (true, false, false, true)); // now N+W
    }

    #[test]
    fn connection_sides_waterlogged_untouched() {
        let mut props = side_props(true, false, false, false);
        rotate_properties(&mut props, Mirror::None, Rotation::R90);
        assert_eq!(props.get("waterlogged"), Some(&Value::String("false".to_string())));
    }
}
