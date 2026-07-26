use std::env;

/// Recursively collect every `.c` file under `dir`.
fn collect_c_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_c_files(&path, out);
        } else if path.extension().is_some_and(|x| x == "c") {
            println!("cargo:rerun-if-changed={}", path.display());
            out.push(path);
        }
    }
}

fn main() {
    tauri_build::build();

    // ── cubiomes ──────────────────────────────────────────────────────────────
    println!("cargo:rerun-if-changed=cubiomes_bridge.c");

    let cubiomes = "../cubiomes";
    let asan = env::var("CUBIOMES_ASAN").is_ok();
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    let cubiomes_sources = [
        "biomenoise.c", "biomes.c", "finders.c", "generator.c",
        "layers.c", "noise.c", "quadbase.c", "util.c",
        // terrain heightmaps, plus every piece/feature generator finders.c's
        // getStructurePieces (and cubiomes_bridge.c directly) call out to —
        // upstream split these into features/*.c and carver.c; they used to
        // be inline in finders.c, so a straight submodule bump silently drops
        // them from the link unless listed explicitly here.
        "terrainnoise.c", "carver.c",
        "features/stronghold.c", "features/abandoned_camp.c",
        "features/end_city.c", "features/fortress.c", "features/ore.c",
    ];

    // Recompile when the submodule sources or headers change (e.g. after a
    // `git submodule update`); the btree tables live in tables/*.h.
    for src in cubiomes_sources {
        println!("cargo:rerun-if-changed={cubiomes}/{src}");
    }
    println!("cargo:rerun-if-changed={cubiomes}/biomes.h");
    println!("cargo:rerun-if-changed={cubiomes}/biomenoise.h");
    println!("cargo:rerun-if-changed={cubiomes}/finders.h");
    println!("cargo:rerun-if-changed={cubiomes}/carver.h");
    println!("cargo:rerun-if-changed={cubiomes}/generator.h");
    println!("cargo:rerun-if-changed={cubiomes}/tables");
    println!("cargo:rerun-if-changed={cubiomes}/loot");
    println!("cargo:rerun-if-changed={cubiomes}/features");

    let mut build = cc::Build::new();
    build.include(cubiomes).file("cubiomes_bridge.c");
    for src in cubiomes_sources {
        build.file(format!("{cubiomes}/{src}"));
    }

    // Loot library (cJSON + per-structure loot tables) — required by
    // getStrongholdLoot / getStructurePieces / the loot preview commands.
    // Compile every .c under loot/ (recursively: cjson/ and loot_tables/).
    let mut loot_sources = Vec::new();
    collect_c_files(std::path::Path::new(&format!("{cubiomes}/loot")), &mut loot_sources);
    for f in &loot_sources {
        build.file(f);
    }

    if asan {
        // -fsanitize=address and friends are GCC/Clang flags; MSVC's ASan uses
        // a different flag (/fsanitize=address) and doesn't support the other
        // two at all. Fail loudly here instead of either a cryptic "unrecognized
        // command-line option" from the compiler or silently building without
        // instrumentation (flag_if_supported would just drop them unnoticed,
        // which is worse than not building at all for a debugging build).
        if target_os == "windows" {
            panic!("CUBIOMES_ASAN is not supported when building for Windows/MSVC — \
                    -fsanitize=address (GCC/Clang) has no equivalent here. Unset \
                    CUBIOMES_ASAN, or build under WSL/MSYS2 with a GCC/Clang toolchain instead.");
        }
        build.opt_level(1)
            .flag("-fsanitize=address")
            .flag("-fno-omit-frame-pointer")
            .flag("-fno-optimize-sibling-calls");
    } else {
        build.opt_level(3)
            .flag_if_supported("-ffast-math");
    }

    build.compile("cubiomes");

    // ── leveldb + snappy ──────────────────────────────────────────────────────
    // Bedrock Edition uses a Mojang-modified LevelDB with Snappy compression.
    // Sources are vendored as git submodules at ../leveldb/ and ../snappy/.
    println!("cargo:rerun-if-changed=leveldb_bridge.c");

    let ldb    = "../leveldb";
    let snappy = "../snappy";

    // Only build if the submodules have been initialized.
    if std::path::Path::new(&format!("{ldb}/include/leveldb/c.h")).exists() {
        // Generate snappy-stubs-public.h if not present (normally produced by CMake).
        let stubs = format!("{snappy}/snappy-stubs-public.h");
        if !std::path::Path::new(&stubs).exists() {
            let have_uio = if target_os == "windows" { "0" } else { "1" };
            let content = format!(
                "#ifndef SNAPPY_STUBS_PUBLIC_H_\n\
                 #define SNAPPY_STUBS_PUBLIC_H_\n\
                 #include <cstddef>\n\
                 #if {have_uio}\n\
                 #include <sys/uio.h>\n\
                 #endif\n\
                 #define SNAPPY_MAJOR 1\n\
                 #define SNAPPY_MINOR 2\n\
                 #define SNAPPY_PATCHLEVEL 2\n\
                 #define SNAPPY_VERSION ((SNAPPY_MAJOR<<16)|(SNAPPY_MINOR<<8)|SNAPPY_PATCHLEVEL)\n\
                 namespace snappy {{\n\
                 #if !{have_uio}\n\
                 struct iovec {{ void* iov_base; size_t iov_len; }};\n\
                 #endif\n\
                 }}\n\
                 #endif\n"
            );
            std::fs::write(&stubs, content).expect("failed to write snappy-stubs-public.h");
        }

        // Bridge must be compiled as C (not C++) so its symbols have C linkage
        // and the Rust FFI layer in leveldb_ffi.rs can find them unmangled.
        cc::Build::new()
            .include(format!("{ldb}/include"))
            .file("leveldb_bridge.c")
            .opt_level(3)
            .warnings(false)
            .compile("leveldb_bridge");

        let mut ldb_build = cc::Build::new();
        ldb_build
            .cpp(true)
            .include(format!("{ldb}/include"))
            .include(ldb)
            .include(snappy)
            .file(format!("{ldb}/db/builder.cc"))
            .file(format!("{ldb}/db/c.cc"))
            .file(format!("{ldb}/db/db_impl.cc"))
            .file(format!("{ldb}/db/db_iter.cc"))
            .file(format!("{ldb}/db/dbformat.cc"))
            .file(format!("{ldb}/db/dumpfile.cc"))
            .file(format!("{ldb}/db/filename.cc"))
            .file(format!("{ldb}/db/log_reader.cc"))
            .file(format!("{ldb}/db/log_writer.cc"))
            .file(format!("{ldb}/db/memtable.cc"))
            .file(format!("{ldb}/db/repair.cc"))
            .file(format!("{ldb}/db/table_cache.cc"))
            .file(format!("{ldb}/db/version_edit.cc"))
            .file(format!("{ldb}/db/version_set.cc"))
            .file(format!("{ldb}/db/write_batch.cc"))
            .file(format!("{ldb}/table/block.cc"))
            .file(format!("{ldb}/table/block_builder.cc"))
            .file(format!("{ldb}/table/filter_block.cc"))
            .file(format!("{ldb}/table/format.cc"))
            .file(format!("{ldb}/table/iterator.cc"))
            .file(format!("{ldb}/table/merger.cc"))
            .file(format!("{ldb}/table/table.cc"))
            .file(format!("{ldb}/table/table_builder.cc"))
            .file(format!("{ldb}/table/two_level_iterator.cc"))
            .file(format!("{ldb}/util/arena.cc"))
            .file(format!("{ldb}/util/bloom.cc"))
            .file(format!("{ldb}/util/cache.cc"))
            .file(format!("{ldb}/util/coding.cc"))
            .file(format!("{ldb}/util/comparator.cc"))
            .file(format!("{ldb}/util/crc32c.cc"))
            .file(format!("{ldb}/util/env.cc"))
            .file(format!("{ldb}/util/filter_policy.cc"))
            .file(format!("{ldb}/util/hash.cc"))
            .file(format!("{ldb}/util/logging.cc"))
            .file(format!("{ldb}/util/options.cc"))
            .file(format!("{ldb}/util/status.cc"))
            // Snappy
            .file(format!("{snappy}/snappy.cc"))
            .file(format!("{snappy}/snappy-sinksource.cc"))
            .file(format!("{snappy}/snappy-stubs-internal.cc"))
            // LevelDB uses Snappy when HAVE_SNAPPY is defined
            .define("HAVE_SNAPPY", "1")
            .define("LEVELDB_COMPILE_LIBRARY", None)
            .opt_level(3)
            .warnings(false);

        if target_os == "windows" {
            ldb_build
                .define("LEVELDB_PLATFORM_WINDOWS", None)
                .define("WIN32_LEAN_AND_MEAN", None)
                .define("NOMINMAX", None)
                .file(format!("{ldb}/util/env_windows.cc"));
        } else {
            ldb_build
                .define("LEVELDB_PLATFORM_POSIX", None)
                .file(format!("{ldb}/util/env_posix.cc"));
        }

        ldb_build.compile("leveldb_snappy");

        println!("cargo:rustc-cfg=bedrock_ldb");
        println!("cargo:rustc-check-cfg=cfg(bedrock_ldb)");
    } else {
        println!("cargo:rustc-check-cfg=cfg(bedrock_ldb)");
        println!("cargo:warning=LevelDB submodule not found at {ldb}/include/leveldb/c.h — Bedrock LevelDB support disabled. Run: git submodule update --init leveldb snappy");
    }
}
