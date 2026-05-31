use std::env;

fn main() {
    tauri_build::build();

    // ── cubiomes ──────────────────────────────────────────────────────────────
    println!("cargo:rerun-if-changed=cubiomes_bridge.c");

    let cubiomes = "../cubiomes";
    let asan = env::var("CUBIOMES_ASAN").is_ok();

    let mut build = cc::Build::new();
    build
        .include(cubiomes)
        .file("cubiomes_bridge.c")
        .file(format!("{cubiomes}/biomenoise.c"))
        .file(format!("{cubiomes}/biomes.c"))
        .file(format!("{cubiomes}/finders.c"))
        .file(format!("{cubiomes}/generator.c"))
        .file(format!("{cubiomes}/layers.c"))
        .file(format!("{cubiomes}/noise.c"))
        .file(format!("{cubiomes}/quadbase.c"))
        .file(format!("{cubiomes}/util.c"));

    if asan {
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
        let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

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
