"""Opt-in bounded export samples; frame numbers always refer to the source timeline."""


def sample_range(config, total_frames, native_post):
    value = config.get('diagnosticRange')
    if value is None:
        return 0, total_frames
    if not native_post or not config.get('newOnly') or not isinstance(value, dict):
        raise ValueError('诊断区间需要原生合成与新输出文件')
    start, end = value.get('startFrame'), value.get('endFrame')
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= total_frames or end-start > 300:
        raise ValueError('诊断区间必须是工程内的 1～300 帧')
    return start, end


def validate_profile(value):
    if not isinstance(value, bool):
        raise ValueError('Invalid profiling flag')
    return value
