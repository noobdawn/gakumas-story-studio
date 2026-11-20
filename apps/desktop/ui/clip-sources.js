/* Source identity belongs to the asset. The timeline name belongs to the clip. */
globalThis.CreatorClipSources = (() => {
  'use strict';

  function card(esc, {title, name, source, detail, error, controls = ''}) {
    return `<section class="clip-motion-source"><div class="section-title">${esc(title)}</div>
      <strong class="clip-motion-name">${esc(name)}</strong>
      ${source ? `<div class="clip-motion-original"><span>原始名称</span><code>${esc(source)}</code></div>` : ''}
      ${detail ? `<p class="hint">${esc(detail)}</p>` : ''}
      ${error ? `<p class="error">${esc(error)}</p>` : ''}${controls}</section>`;
  }

  function picker(e, track, clip, config) {
    if (track?.locked) return e.notify('轨道已锁定');
    const initial = e.state(), original = clip?.assetId, selectedClip = initial.selectedClip;
    const {key, title, hint, kinds, items, describe, prepare, apply} = config;
    const esc = e.esc, prefix = key + '-picker-', pageSize = 60;
    let chosen = original, page = 1, busy = false;
    e.showModal(`<div class="modal-head"><div><h2>${esc(title)}</h2><p>${esc(clip?.name || config.context)}</p></div><button data-close class="icon-button" aria-label="关闭">×</button></div>
      <div class="modal-body"><p class="hint">${esc(hint)}</p><div class="field"><label for="${prefix}search">搜索素材</label>
      <input id="${prefix}search" class="input" placeholder="按名称或原始名称搜索，空格分隔关键词">
      ${kinds ? `<label for="${prefix}kind">素材类型</label><select id="${prefix}kind">${Object.entries(kinds).map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('')}</select>` : ''}</div>
      <div id="${prefix}list" class="expression-picker-list" aria-label="候选素材"></div>
      <div class="motion-picker-pages"><button id="${prefix}prev">上一页</button><span id="${prefix}count" class="hint" aria-live="polite"></span><button id="${prefix}next">下一页</button></div>
      <p id="${prefix}choice" class="hint clip-source-choice" aria-live="polite"></p><p id="${prefix}error" class="error" role="alert"></p></div>
      <div class="modal-actions"><button id="${prefix}cancel" class="top-button">取消</button><button id="${prefix}apply" class="solid-button">${clip ? '应用到片段' : '添加片段'}</button></div>`);
    const field = suffix => document.getElementById(prefix + suffix);
    const list = field('list'), search = field('search'), kind = field('kind');
    const candidates = () => items(kind?.value);
    const pickAttribute = 'data-' + key + '-pick';

    function draw() {
      const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const matches = candidates().filter(a => {
        const text = [e.name(a.id), a.source, a.originalName, a.filmAudio?.name, a.filmAudio?.streamName].join(' ').toLocaleLowerCase();
        return terms.every(term => text.includes(term));
      }).sort((a, b) => Number(b.id === original) - Number(a.id === original));
      const pages = Math.max(1, Math.ceil(matches.length / pageSize));
      page = Math.min(page, pages);
      list.innerHTML = matches.slice((page - 1) * pageSize, page * pageSize).map(a =>
        `<button class="costume-picker-row" ${pickAttribute}="${esc(a.id)}" aria-pressed="${a.id === chosen}"><span>${esc(e.name(a.id))}${a.id === original ? '（当前）' : ''}<small>${esc(a.source)}</small></span><small>${esc(describe(a))}</small></button>`
      ).join('') || '<p class="hint">没有匹配的可用素材。</p>';
      field('count').textContent = `${matches.length} 项 · ${page} / ${pages} 页`;
      field('prev').disabled = page <= 1;
      field('next').disabled = page >= pages;
      field('choice').textContent = chosen ? '已选择 ' + e.name(chosen) : '请选择素材';
      field('apply').disabled = !chosen || chosen === original;
    }
    function checkTarget() {
      if (!list.isConnected || document.querySelector('#overlay').classList.contains('hidden') ||
          e.state() !== initial || initial.selectedClip !== selectedClip ||
          clip && (!initial.tracks.includes(track) || !track.clips.includes(clip) || clip.assetId !== original)) {
        throw Error(clip ? '工程或片段已改变，请重新选择素材' : '工程或选择已改变，请重新选择素材');
      }
      if (track?.locked) throw Error('轨道已锁定');
    }
    function candidate() {
      const asset = candidates().find(a => a.id === chosen);
      if (!asset) throw Error('素材已移除或不适用于此片段');
      return asset;
    }
    function filterChanged() { page = 1; draw(); list.scrollTop = 0; }
    search.oninput = filterChanged;
    if (kind) kind.onchange = () => {
      if (!candidates().some(a => a.id === chosen)) chosen = original;
      filterChanged();
    };
    field('prev').onclick = () => { page--; draw(); list.scrollTop = 0; };
    field('next').onclick = () => { page++; draw(); list.scrollTop = 0; };
    list.onclick = event => {
      const button = event.target.closest('[' + pickAttribute + ']');
      if (button && !busy) { chosen = button.getAttribute(pickAttribute); field('error').textContent = ''; draw(); }
    };
    field('cancel').onclick = e.closeModal;
    field('apply').onclick = async () => {
      if (busy || !chosen || chosen === original) return;
      busy = true;
      const modal = list.closest('#modal');
      modal.querySelectorAll('.modal-body button,.modal-body input,.modal-body select,.solid-button').forEach(el => el.disabled = true);
      try {
        checkTarget();
        const asset = candidate(), prepared = prepare ? await prepare(asset) : undefined;
        checkTarget();
        const current = candidate();
        if (current.scope !== asset.scope || current.projectId !== asset.projectId || current.extension !== asset.extension) throw Error('素材来源已改变，请重新选择');
        const before = structuredClone(initial);
        const followName = clip && config.followSourceName && !clip.nameEdited && clip.name === e.name(original);
        apply(current, prepared);
        if (followName) clip.name = e.name(current.id);
        e.remember(before);
        e.closeModal();
        e.render();
      } catch (error) {
        if (list.isConnected) field('error').textContent = error.message;
      } finally {
        busy = false;
        if (list.isConnected) {
          search.disabled = false;
          if (kind) kind.disabled = false;
          draw();
        }
      }
    };
    draw();
    search.focus();
  }
  return {card, picker};
})();
