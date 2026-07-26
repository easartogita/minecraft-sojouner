// Minimal little-endian binary NBT parser for Bedrock Edition.
//
// Bedrock level.dat uses the same NBT tag IDs as Java but stores all
// multibyte values as little-endian. fastnbt only handles Java big-endian
// NBT, so we parse the handful of tags we actually need by hand.
//
// Unsupported/unknown tags are skipped by consuming the correct number of
// bytes from the reader, so the parser stays in sync even if Mojang adds
// fields we don't care about.

use std::collections::HashMap;
use std::io::{self, Cursor, Read};

#[derive(Debug, Clone)]
pub enum LeNbt {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<u8>),
    String(String),
    List(Vec<LeNbt>),
    Compound(HashMap<String, LeNbt>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

impl LeNbt {
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Self::Long(v)  => Some(*v),
            Self::Int(v)   => Some(*v as i64),
            Self::Short(v) => Some(*v as i64),
            Self::Byte(v)  => Some(*v as i64),
            _ => None,
        }
    }
    pub fn as_i32(&self) -> Option<i32> {
        match self {
            Self::Int(v)   => Some(*v),
            Self::Short(v) => Some(*v as i32),
            Self::Byte(v)  => Some(*v as i32),
            _ => None,
        }
    }
    pub fn as_f32(&self) -> Option<f32> {
        match self { Self::Float(v) => Some(*v), _ => None }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self { Self::String(s) => Some(s.as_str()), _ => None }
    }
    pub fn as_compound(&self) -> Option<&HashMap<String, LeNbt>> {
        match self { Self::Compound(m) => Some(m), _ => None }
    }
    pub fn as_list(&self) -> Option<&[LeNbt]> {
        match self { Self::List(v) => Some(v), _ => None }
    }
    pub fn get(&self, key: &str) -> Option<&LeNbt> {
        self.as_compound()?.get(key)
    }
}

// ── Public entry points ──────────────────────────────────────────────────────

/// Parse a root-level Bedrock NBT compound from `data`.
/// Bedrock level.dat has an 8-byte header *before* the NBT payload; strip it
/// in the caller (`bedrock/nbt_reader.rs`) before passing the slice here.
pub fn parse_le_nbt(data: &[u8]) -> Result<LeNbt, String> {
    let mut cur = Cursor::new(data);
    // Root is always a TAG_Compound (10) with a name.
    let tag = read_u8(&mut cur).map_err(|e| e.to_string())?;
    if tag != 10 {
        return Err(format!("Expected root TAG_Compound (10), got {tag}"));
    }
    let _name = read_le_string(&mut cur).map_err(|e| e.to_string())?;
    read_compound(&mut cur).map_err(|e| e.to_string())
}

/// Parse a sequence of back-to-back LE NBT TAG_Compound values from `data`.
/// Used for Bedrock block entity and entity records stored under a single
/// LevelDB value key.
pub fn parse_compound_sequence(data: &[u8]) -> Vec<HashMap<String, LeNbt>> {
    let mut cur = Cursor::new(data);
    let mut out = Vec::new();
    loop {
        let pos = cur.position();
        if pos >= data.len() as u64 { break; }
        // Each compound starts with tag byte = 10 and a (usually empty) name.
        let tag = match read_u8(&mut cur) {
            Ok(t) => t,
            Err(_) => break,
        };
        if tag != 10 { break; }
        let _name = match read_le_string(&mut cur) {
            Ok(n) => n,
            Err(_) => break,
        };
        match read_compound(&mut cur) {
            Ok(LeNbt::Compound(m)) => out.push(m),
            _ => break,
        }
    }
    out
}

// ── Internal readers ─────────────────────────────────────────────────────────

fn read_u8(r: &mut Cursor<&[u8]>) -> io::Result<u8> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b)?;
    Ok(b[0])
}

fn read_le_i16(r: &mut Cursor<&[u8]>) -> io::Result<i16> {
    let mut b = [0u8; 2]; r.read_exact(&mut b)?; Ok(i16::from_le_bytes(b))
}
fn read_le_i32(r: &mut Cursor<&[u8]>) -> io::Result<i32> {
    let mut b = [0u8; 4]; r.read_exact(&mut b)?; Ok(i32::from_le_bytes(b))
}
fn read_le_i64(r: &mut Cursor<&[u8]>) -> io::Result<i64> {
    let mut b = [0u8; 8]; r.read_exact(&mut b)?; Ok(i64::from_le_bytes(b))
}
fn read_le_f32(r: &mut Cursor<&[u8]>) -> io::Result<f32> {
    let mut b = [0u8; 4]; r.read_exact(&mut b)?; Ok(f32::from_le_bytes(b))
}
fn read_le_f64(r: &mut Cursor<&[u8]>) -> io::Result<f64> {
    let mut b = [0u8; 8]; r.read_exact(&mut b)?; Ok(f64::from_le_bytes(b))
}

fn read_le_string(r: &mut Cursor<&[u8]>) -> io::Result<String> {
    let len = {
        let mut b = [0u8; 2]; r.read_exact(&mut b)?; u16::from_le_bytes(b)
    };
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn read_compound(r: &mut Cursor<&[u8]>) -> io::Result<LeNbt> {
    let mut map = HashMap::new();
    loop {
        let tag = read_u8(r)?;
        if tag == 0 { break; } // TAG_End
        let name = read_le_string(r)?;
        let val  = read_payload(r, tag)?;
        map.insert(name, val);
    }
    Ok(LeNbt::Compound(map))
}

/// Bytes left unread in `r`. Used to reject a declared element count/length
/// that a corrupt or adversarial buffer claims but can't possibly back —
/// without this, `Vec::with_capacity`/`vec![0; len]` on an untrusted length
/// (e.g. length-prefixed ByteArray/IntArray/LongArray fields) can attempt a
/// multi-GB allocation; on failure that calls Rust's `handle_alloc_error`,
/// which *aborts* the process outright rather than returning a catchable error.
fn remaining(r: &Cursor<&[u8]>) -> usize {
    (r.get_ref().len() as u64).saturating_sub(r.position()) as usize
}

fn read_payload(r: &mut Cursor<&[u8]>, tag: u8) -> io::Result<LeNbt> {
    match tag {
        1  => Ok(LeNbt::Byte (read_u8(r)? as i8)),
        2  => Ok(LeNbt::Short(read_le_i16(r)?)),
        3  => Ok(LeNbt::Int  (read_le_i32(r)?)),
        4  => Ok(LeNbt::Long (read_le_i64(r)?)),
        5  => Ok(LeNbt::Float(read_le_f32(r)?)),
        6  => Ok(LeNbt::Double(read_le_f64(r)?)),
        7  => {
            let len = read_le_i32(r)?.max(0) as usize;
            if len > remaining(r) {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof,
                    format!("ByteArray length {len} exceeds remaining buffer")));
            }
            let mut v = vec![0u8; len]; r.read_exact(&mut v)?;
            Ok(LeNbt::ByteArray(v))
        }
        8  => Ok(LeNbt::String(read_le_string(r)?)),
        9  => {
            let elem_tag = read_u8(r)?;
            let count = read_le_i32(r)?.max(0) as usize;
            // No upfront `with_capacity(count)`: element size varies by tag (a
            // nested List/Compound isn't fixed-width), so we can't bound it the
            // way the fixed-width arrays below can. Growing via `push` means a
            // bogus `count` only allocates as far as real, parseable input
            // actually takes it before `read_payload` hits EOF and errors out.
            let mut list = Vec::new();
            for _ in 0..count {
                list.push(read_payload(r, elem_tag)?);
            }
            Ok(LeNbt::List(list))
        }
        10 => read_compound(r),
        11 => {
            let len = read_le_i32(r)?.max(0) as usize;
            if len > remaining(r) / 4 {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof,
                    format!("IntArray length {len} exceeds remaining buffer")));
            }
            let mut v = Vec::with_capacity(len);
            for _ in 0..len { v.push(read_le_i32(r)?); }
            Ok(LeNbt::IntArray(v))
        }
        12 => {
            let len = read_le_i32(r)?.max(0) as usize;
            if len > remaining(r) / 8 {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof,
                    format!("LongArray length {len} exceeds remaining buffer")));
            }
            let mut v = Vec::with_capacity(len);
            for _ in 0..len { v.push(read_le_i64(r)?); }
            Ok(LeNbt::LongArray(v))
        }
        _ => {
            // Unknown tag: we can't skip it safely without knowing its size.
            Err(io::Error::new(io::ErrorKind::InvalidData,
                format!("Unknown NBT tag id: {tag}")))
        }
    }
}
