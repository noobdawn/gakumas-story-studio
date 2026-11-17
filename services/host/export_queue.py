"""Bounded GPU state batches. The job owns frame identity and session tokens."""
import json
from export_diagnostics import merged_frame_request, validate_gpu_reply

REQUEST_LIMIT = 1024 * 1024
QUEUE_BYTES = 2 * 1024 * 1024


def capacity(config, merged):
    value = config.get('queueCapacity', 0)
    if type(value) is not int or value not in (0, 1, 4, 8) or value and not merged:
        raise ValueError('状态队列仅支持合并 GPU 诊断，容量为 1、4 或 8')
    return value


def require_session(job, message):
    if not job or not job.queue_capacity or message.get('queueSession') != job.queue_session:
        raise ValueError('导出队列会话已失效')


def frames(job, message, token, prepare):
    require_session(job, message)
    rows = message.get('frames')
    if not isinstance(rows, list) or not 1 <= len(rows) <= min(4, job.queue_capacity):
        raise ValueError('导出批次帧数无效')
    result = []
    for offset, row in enumerate(rows):
        index = job.queue_enqueued + offset
        if not isinstance(row, dict) or type(row.get('index')) is not int or row['index'] != index or index >= job.frames:
            raise ValueError('导出批次帧序无效')
        authoritative = dict(token=token, id=row.get('id', 0), kind='state-frame',
            frameWidth=job.width, frameHeight=job.height, captureUiLayer=False, includeUiOverlay=job.native_post,
            frameSupersampling=job.supersampling,
            profileExport=job.profile, frameIndex=job.start_frame+index, runId=job.run_id,
            skipPreRender=False, gpuColor=False, gpuVideo=True, exportIndex=index,
            queueSession=job.queue_session, queueCapacity=0, queueFrames=None)
        packet = merged_frame_request(row.get('state'), authoritative, True)
        prepare(packet)
        result.append(packet)
    # Reserve some envelope space; do not silently enlarge the transport limit.
    if len(json.dumps(result, allow_nan=False, separators=(',', ':')).encode()) > REQUEST_LIMIT-4096:
        raise ValueError('解析后的导出批次过大，请减少批次帧数')
    return result


def consume(job, reply, requested):
    require_session(job, reply)
    if reply.get('ok') is not True or type(reply.get('queueAdmitted')) is not bool:
        raise ValueError('导出队列回复无效')
    enqueued = job.queue_enqueued + (requested if reply['queueAdmitted'] else 0)
    rows = reply.get('queueResults')
    reported = reply.get('queueReported')
    submitted = reply.get('queueSubmitted')
    size = reply.get('queuePendingBytes')
    if (reply.get('queueEnqueued') != enqueued or type(reply.get('queueEnqueued')) is not int
        or not isinstance(rows, list) or len(rows) > job.queue_capacity
        or type(reported) is not int or reported != job.count+len(rows)
        or type(submitted) is not int or not reported <= submitted <= enqueued <= job.frames
        or enqueued-reported > job.queue_capacity or type(size) is not int or not 0 <= size <= QUEUE_BYTES
        or not requested and reply['queueAdmitted']):
        raise ValueError('导出队列计数无效')
    # Validate the entire reply before updating any job counters.
    completed = job.gpu_completed
    for index, row in enumerate(rows, job.count+1):
        completed = validate_gpu_reply(row, index, completed)
    job.queue_enqueued = enqueued
    for row in rows:
        job.write_gpu(row)
    return reply
