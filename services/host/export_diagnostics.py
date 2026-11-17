"""Opt-in bounded export samples; frame numbers always refer to the source timeline."""
import json


def validate_merged_frame(config, gpu_video):
    value = config.get('mergedFrame', False)
    if type(value) is not bool or value and not gpu_video:
        raise ValueError('合并帧命令仅支持 GPU 视频诊断')
    return value


def merged_frame_request(state, frame, enabled):
    if not enabled:
        if state is not None:
            raise ValueError('当前导出未启用合并帧命令')
        return frame
    if not isinstance(state, dict) or frame.get('gpuVideo') is not True:
        raise ValueError('合并帧缺少有效演出状态')
    # Frame identity, dimensions, flags and token always come from the job/host.
    packet = dict(state)
    packet.update(frame)
    packet['kind'] = 'state-frame'
    return packet


def diagnostic_limit(config):
    # Only the validated merged GPU path gets a bounded 60s-at-30fps probe.
    return 1800 if config.get('gpuVideo') is True and config.get('mergedFrame') is True else 300


def sample_range(config, total_frames, native_post):
    value = config.get('diagnosticRange')
    if value is None:
        return 0, total_frames
    if not native_post or not config.get('newOnly') or not isinstance(value, dict):
        raise ValueError('诊断区间需要原生合成与新输出文件')
    start, end = value.get('startFrame'), value.get('endFrame')
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= total_frames or end-start > diagnostic_limit(config):
        raise ValueError(f'诊断区间必须是工程内的 1～{diagnostic_limit(config)} 帧')
    return start, end


def validate_profile(value):
    if not isinstance(value, bool):
        raise ValueError('Invalid profiling flag')
    return value


def validate_gpu_video(config, native_post, native_ui, frames):
    value = config.get('gpuVideo', False)
    if not isinstance(value, bool):
        raise ValueError('Invalid GPU video flag')
    if value and (not native_post or native_ui or config.get('diagnosticRange') is None
                  or config.get('newOnly') is not True or not 1 <= frames <= diagnostic_limit(config)):
        raise ValueError(f'GPU 视频仅支持原生合成的 1～{diagnostic_limit(config)} 帧诊断与新输出文件')
    return value


def validate_gpu_reply(reply, accepted, previous_completed=0, final=False):
    if not isinstance(reply, dict) or reply.get('ok') is not True:
        raise RuntimeError('GPU 导出失败：' + str(reply.get('error', 'Player 回复无效') if isinstance(reply, dict) else 'Player 回复无效'))
    a, c = reply.get('gpuAccepted'), reply.get('gpuCompleted')
    if type(a) is not int or type(c) is not int or a != accepted or not previous_completed <= c <= a or (final and c != a):
        raise ValueError('GPU 导出帧计数无效')
    return c


def validate_gpu_frames(path, frames, fps):
    # This PoC is CFR with no B frames: output timestamp equals local input index.
    if not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise ValueError('GPU 帧记录缺失或过大')
    with path.open(encoding='utf-8') as stream:
        count = 0
        for line in stream:
            if count >= frames or len(line) > 4096:
                raise ValueError('GPU 帧记录数量或长度无效')
            try:
                row = json.loads(line)
            except ValueError as error:
                raise ValueError('GPU 帧记录格式无效') from error
            expected = dict(index=count, timestamp=count, duration=1, timebaseNum=1, timebaseDen=fps)
            if not isinstance(row, dict) or any(type(row.get(k)) is not int or row[k] != v for k, v in expected.items()):
                raise ValueError('GPU 帧记录顺序或时间戳无效')
            if 'encodedTimestamp' in row and (type(row['encodedTimestamp']) is not int or row['encodedTimestamp'] != count):
                raise ValueError('GPU 编码时间戳无效')
            count += 1
    if count != frames:
        raise ValueError('GPU 帧记录不完整')
    return count
