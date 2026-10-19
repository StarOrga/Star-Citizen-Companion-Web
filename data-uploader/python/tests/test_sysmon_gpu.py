"""Whole-PC monitor — GPU load / VRAM aggregation and the stdin pid protocol."""

from sc_extract.sysmon import (
    GPU_COUNTERS,
    build_gpu,
    engine_load,
    engine_type_sums,
    parse_control_line,
    parse_gpu_instance,
    pick_luid,
)

DGPU = "0x00000000_0x0000d1e2"
IGPU = "0x00000000_0x0000a001"


def eng(pid: int, engtype: str, luid: str = DGPU, n: int = 0) -> str:
    return f"pid_{pid}_luid_{luid}_phys_0_eng_{n}_engtype_{engtype}"


def proc(pid: int, luid: str = DGPU) -> str:
    return f"pid_{pid}_luid_{luid}_phys_0"


def adapter(luid: str = DGPU) -> str:
    return f"luid_{luid}_phys_0"


# --- instance names ---------------------------------------------------------

def test_parse_engine_instance():
    assert parse_gpu_instance("pid_1234_luid_0x00000000_0x0000D1E2_phys_0_eng_0_engtype_3D") == {
        "pid": 1234, "luid": DGPU, "engtype": "3D",
    }


def test_parse_engtype_with_underscore_and_process_and_adapter_instances():
    assert parse_gpu_instance(eng(7, "Compute_0"))["engtype"] == "Compute_0"
    assert parse_gpu_instance(proc(99)) == {"pid": 99, "luid": DGPU, "engtype": None}
    assert parse_gpu_instance(adapter()) == {"pid": None, "luid": DGPU, "engtype": None}
    assert parse_gpu_instance("") == {"pid": None, "luid": None, "engtype": None}
    assert parse_gpu_instance("_Total") == {"pid": None, "luid": None, "engtype": None}


def test_counters_are_english_gpu_wildcards():
    paths = dict(GPU_COUNTERS)
    assert paths == {
        "engine": r"\GPU Engine(*)\Utilization Percentage",
        "adapterMem": r"\GPU Adapter Memory(*)\Dedicated Usage",
        "processMem": r"\GPU Process Memory(*)\Dedicated Usage",
    }


# --- load -------------------------------------------------------------------

def test_load_is_the_busiest_engine_type_summed_over_processes():
    engines = {
        eng(1, "3D"): 30.0, eng(2, "3D"): 25.0,          # 3D = 55
        eng(1, "Copy", n=1): 10.0,                       # Copy = 10
        eng(3, "VideoDecode", n=2): 60.0,                # VideoDecode = 60 -> wins
    }
    assert engine_type_sums(engines) == {"3D": 55.0, "Copy": 10.0, "VideoDecode": 60.0}
    assert engine_load(engines) == 60.0


def test_each_engine_type_is_clamped_to_100_and_glitches_count_as_nothing():
    engines = {eng(1, "3D"): 80.0, eng(2, "3D"): 70.0, eng(3, "Copy"): float("nan"), eng(4, "Copy"): -3.0}
    assert engine_type_sums(engines) == {"3D": 100.0}
    assert engine_load({}) == 0.0


def test_run_load_only_counts_uploader_pids_and_never_exceeds_total():
    engines = {
        eng(10, "3D"): 40.0,               # game
        eng(20, "3D"): 15.0,               # uploader
        eng(20, "Compute_0", n=3): 90.0,   # uploader, busiest of its own types
        eng(21, "Compute_0", n=3): 30.0,   # uploader
    }
    assert engine_load(engines, pids={20, 21}) == 100.0  # 90 + 30, clamped
    gpu = build_gpu(engines, {adapter(): 1e9}, {}, {20, 21})
    assert gpu["loadPct"] == 100.0
    assert gpu["runLoadPct"] == 100.0
    assert gpu["runLoadPct"] <= gpu["loadPct"]
    gpu = build_gpu({eng(10, "3D"): 70.0, eng(20, "3D"): 12.34}, {adapter(): 1e9}, {}, {20})
    assert gpu["loadPct"] == 82.3
    assert gpu["runLoadPct"] == 12.3


def test_empty_pid_set_gives_zero_run_share():
    gpu = build_gpu({eng(10, "3D"): 50.0}, {adapter(): 1e9}, {proc(10): 5e8}, set())
    assert gpu["runLoadPct"] == 0.0
    assert gpu["vramRunBytes"] == 0


# --- adapter choice ---------------------------------------------------------

def test_primary_adapter_is_the_one_with_most_dedicated_memory():
    # The iGPU decodes a video (busy engines) but holds no dedicated memory.
    engines = {eng(1, "VideoDecode", IGPU): 90.0, eng(2, "3D", DGPU): 20.0}
    mem = {adapter(IGPU): 0.0, adapter(DGPU): 2.5e9}
    assert pick_luid(mem, engines) == DGPU
    gpu = build_gpu(engines, mem, {}, set())
    assert gpu["loadPct"] == 20.0  # the iGPU's 90 % never mixes in
    assert gpu["vramUsedBytes"] == 2_500_000_000


def test_adapter_tie_falls_back_to_engine_load():
    engines = {eng(1, "3D", IGPU): 5.0, eng(2, "3D", DGPU): 40.0}
    assert pick_luid({adapter(IGPU): 0.0, adapter(DGPU): 0.0}, engines) == DGPU
    assert pick_luid({}, engines) == DGPU
    assert pick_luid({}, {}) is None


def test_luid_match_is_case_insensitive():
    engines = {eng(5, "3D", "0x00000000_0x0000D1E2"): 10.0}
    gpu = build_gpu(engines, {"luid_0x00000000_0x0000D1E2_phys_0": 1e9},
                    {"pid_5_luid_0x00000000_0x0000D1E2_phys_0": 2e8}, {5})
    assert gpu == {"loadPct": 10.0, "runLoadPct": 10.0, "vramUsedBytes": 1_000_000_000,
                   "vramRunBytes": 200_000_000}


# --- vram -------------------------------------------------------------------

def test_vram_run_sums_uploader_processes_on_the_primary_adapter_only():
    mem = {adapter(DGPU): 4e9, adapter(IGPU): 1e6}
    process_mem = {
        proc(10): 3e9,          # game
        proc(20): 3e8,          # uploader
        proc(21): 2e8,          # uploader
        proc(20, IGPU): 9e8,    # uploader on the iGPU -> not counted
    }
    gpu = build_gpu({eng(10, "3D"): 50.0}, mem, process_mem, {20, 21})
    assert gpu["vramUsedBytes"] == 4_000_000_000
    assert gpu["vramRunBytes"] == 500_000_000
    assert isinstance(gpu["vramUsedBytes"], int) and isinstance(gpu["vramRunBytes"], int)


def test_vram_run_never_exceeds_adapter_usage():
    gpu = build_gpu({eng(20, "3D"): 1.0}, {adapter(): 1e8}, {proc(20): 5e8}, {20})
    assert gpu["vramRunBytes"] == gpu["vramUsedBytes"] == 100_000_000


# --- omission ---------------------------------------------------------------

def test_gpu_block_is_omitted_without_adapter_data():
    assert build_gpu({}, {}, {}, {1}) is None
    assert build_gpu({eng(1, "3D"): 5.0}, {}, {}, {1}) is None
    assert build_gpu({}, {adapter(): 1e9}, {}, {1}) is None


# --- stdin pid protocol -----------------------------------------------------

def test_pids_message_replaces_the_set():
    assert parse_control_line('{"type":"pids","pids":[123,456]}\n') == frozenset({123, 456})
    assert parse_control_line('{"type":"pids","pids":[]}') == frozenset()


def test_invalid_pid_entries_are_dropped():
    assert parse_control_line('{"type":"pids","pids":[1,"2",true,-4,0,3.5,7]}') == frozenset({1, 7})


def test_other_lines_are_ignored():
    for line in ("", "\n", "garbage", "[1,2]", "42", '{"type":"other","pids":[1]}',
                 '{"pids":[1]}', '{"type":"pids","pids":"1,2"}', '{"type":"pids"}', "{broken"):
        assert parse_control_line(line) is None, line
