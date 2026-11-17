
    let isEditMode = true;
    let currentGodTab = 'about';
    let vgsFocusBoxId = null;
    let pendingAudios = [];
    let audioBusy = false;
    let mainBgRef = '';
    let vgsRenderPending = false;
    let vgsSaveTimer = 0;
    let stageFadeSeq = 0;

    const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    const CHAT_IDLE = 'De [PLAY] para escutar.';

    const defaultGodsDatabase = [
      {
        id: 'god_izanami',
        name: 'IZANAMI',
        title: 'MATRON OF THE DEAD',
        pantheon: 'Japonês',
        pantheonImg: '/smite-icons/NewUI_Pantheon_Japanese.webp',
        type: 'Físico',
        typeImg: '/smite-icons/NewUI_Type_Physical.png',
        class: 'Caçador',
        classImg: '/smite-icons/NewUI_Class_Hunter.webp',
        miniQuote: 'Devastem o campo de batalha com foices mortais.',
        difficulty: 'Média',
        lore: 'Izanami foi a deusa japonesa da criação e da morte.',
        dubber: 'Lisa Ortiz',
        releaseDate: '15/09/2016',
        img: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=400&auto=format&fit=crop',
        voiceTree: [],
        announcerTree: [],
        skins: [
          {
            id: 'skin_default',
            name: 'Padrão',
            tier: 'PADRÃO',
            dubber: 'Lisa Ortiz',
            releaseDate: '15/09/2016',
            img: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=400&auto=format&fit=crop'
          }
        ]
      }
    ];

    let godsDatabase = [];
    let vgsDatabase = [];

    let selectedGodIdx = 0;
    let selectedSkinIdx = 0;
    let currentMode = 'gods';
    let historyStack = ['main'];
    let currentVPMode = 'god';

    let editingGodIndex = null;
    let editingSkinIndex = null;
    let editingVgsBoxIdx = 0;
    let editingVgsRowIdx = null;
    let editingVgsMode = 'new-row';
    let editingTreeTarget = null;

    let activeAudioInstance = null;
    let audioSwitchToken = 0;
    let activePlayButtonElement = null;
    let activeAudioLabel = '';
    let chatToken = 0;
    let chatClockTimer = null;
    let audioVolume = 1.0;

    const objectUrlCache = new Map();
    let dbPromise = null;

    function isUselessAudio(ref) {
      return !ref || ref === SILENT_WAV;
    }

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;'
      }[c]));
    }

    function clockStamp() {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    function speechLabel(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    }
    function stripWrappingQuotes(value) {
      const text = String(value ?? '').trim();
      const pairs = [
        ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['«', '»']
      ];
      for (const [open, close] of pairs) {
        if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
          return text.slice(open.length, -close.length).trim();
        }
      }
      return text;
    }


    function openDb() {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const req = indexedDB.open('smite_wiki_media', 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
            if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }).catch((err) => {
          dbPromise = null;
          throw err;
        });
      }
      return dbPromise;
    }

    function idbPut(store, key, value) {
      return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('idb'));
        tx.onabort = () => reject(tx.error || new Error('idb abort'));
      }));
    }

    function idbGet(store, key) {
      return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }));
    }

    function compressImage(blob) {
      return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          const maxSize = 1600;
          let width = img.width;
          let height = img.height;
          const scale = Math.min(1, maxSize / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((out) => {
            URL.revokeObjectURL(url);
            resolve(out || blob);
          }, 'image/jpeg', 0.86);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(blob);
        };
        img.src = url;
      });
    }

    async function storeBlob(blob) {
      let toStore = blob;
      if (blob && blob.type && blob.type.startsWith('image/') && blob.size > 160000) {
        toStore = await compressImage(blob);
      }
      const key = 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await idbPut('blobs', key, toStore);
      const ref = 'idb:' + key;
      objectUrlCache.set(ref, URL.createObjectURL(toStore));
      return ref;
    }

    function mediaSync(ref) {
      if (!ref || isUselessAudio(ref)) return '';
      if (objectUrlCache.has(ref)) return objectUrlCache.get(ref) || '';
      if (typeof ref === 'string' && !ref.startsWith('idb:')) return ref;
      return '';
    }

    async function ensureMedia(ref) {
      if (!ref || isUselessAudio(ref)) return '';
      if (objectUrlCache.has(ref)) return objectUrlCache.get(ref) || '';
      if (typeof ref === 'string' && ref.startsWith('idb:')) {
        const blob = await idbGet('blobs', ref.slice(4));
        if (!blob) {
          objectUrlCache.set(ref, '');
          return '';
        }
        const url = URL.createObjectURL(blob);
        objectUrlCache.set(ref, url);
        return url;
      }
      objectUrlCache.set(ref, ref);
      return ref;
    }

    function cssUrl(ref) {
      const url = mediaSync(ref);
      if (!url) return '';
      return 'url("' + String(url).replace(/"/g, '') + '")';
    }

    function collectRefs(node, acc) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((n) => collectRefs(n, acc));
        return;
      }
      Object.keys(node).forEach((k) => {
        const v = node[k];
        if (typeof v === 'string' && v.startsWith('idb:')) acc.push(v);
        else if (v && typeof v === 'object') collectRefs(v, acc);
      });
    }

    async function migrateInPlace(node) {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          if (typeof node[i] === 'string' && node[i].startsWith('data:')) {
            if (isUselessAudio(node[i])) node[i] = '';
            else {
              try { node[i] = await storeBlob(await (await fetch(node[i])).blob()); } catch (e) {}
            }
          } else if (node[i] && typeof node[i] === 'object') {
            await migrateInPlace(node[i]);
          }
        }
        return;
      }
      if (!node || typeof node !== 'object') return;
      const keys = Object.keys(node);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = node[k];
        if (typeof v === 'string' && v.startsWith('data:')) {
          if (isUselessAudio(v)) node[k] = '';
          else {
            try { node[k] = await storeBlob(await (await fetch(v)).blob()); } catch (e) {}
          }
        } else if (v && typeof v === 'object') {
          await migrateInPlace(v);
        }
      }
    }

    function ensureBoxIds(list) {
      (list || []).forEach((box) => {
        if (!box.id) box.id = 'vgsbox_' + Math.random().toString(36).slice(2, 9);
        (box.rows || []).forEach((row) => normalizeAudioFields(row));
      });
    }

    function normalizeAudioFields(obj) {
      if (!obj) return;
      if (!Array.isArray(obj.audios)) obj.audios = [];
      if (obj.audioUrl && !isUselessAudio(obj.audioUrl) && obj.audios.indexOf(obj.audioUrl) === -1) {
        obj.audios.unshift(obj.audioUrl);
      }
      obj.audios = obj.audios.filter((a) => !isUselessAudio(a));
      obj.audioUrl = obj.audios[0] || '';
    }

    function normalizeTree(nodes) {
      (nodes || []).forEach((n) => {
        normalizeAudioFields(n);
        if (n.children) normalizeTree(n.children);
      });
    }


    function ensureDefaultSkinsAndVoiceData(god) {
      if (!god) return;
      if (!Array.isArray(god.skins)) god.skins = [];

      const norm = (value) => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();

      let defaultIndex = god.skins.findIndex((skin) =>
        skin && (
          norm(skin.name) === 'PADRAO' ||
          skin.id === 'skin_default' ||
          skin.isDefault === true
        )
      );

      if (defaultIndex < 0) {
        god.skins.unshift({
          id: 'skin_default_' + String(god.id || Date.now()),
          name: 'Padrão',
          tier: 'PADRÃO',
          img: god.img || '',
          dubber: god.dubber || '',
          releaseDate: god.releaseDate || '',
          voiceTree: [],
          announcerTree: [],
          vgsDatabase: []
        });
        defaultIndex = 0;
      } else if (defaultIndex > 0) {
        const defaultSkin = god.skins.splice(defaultIndex, 1)[0];
        god.skins.unshift(defaultSkin);
        defaultIndex = 0;
      }

      const defaultSkin = god.skins[0];
      defaultSkin.name = defaultSkin.name || 'Padrão';
      defaultSkin.tier = defaultSkin.tier || 'PADRÃO';
      defaultSkin.img = defaultSkin.img || god.img || '';
      if (!defaultSkin.id) {
        defaultSkin.id = 'skin_default_' + String(god.id || Date.now());
      }

      // Copia dados legados somente para a aparência padrão.
      // Mantém os dados antigos no objeto do deus como cópia de segurança.
      if (!god._legacyVoiceMigratedToDefaultSkin) {
        const fields = ['voiceTree', 'announcerTree', 'vgsDatabase'];
        for (const field of fields) {
          const oldData = god[field];
          const currentData = defaultSkin[field];
          const oldHasData = Array.isArray(oldData) && oldData.length > 0;
          const currentHasData = Array.isArray(currentData) && currentData.length > 0;
          if (oldHasData && !currentHasData) {
            defaultSkin[field] = JSON.parse(JSON.stringify(oldData));
          }
        }
        god._legacyVoiceMigratedToDefaultSkin = true;
      }

      for (const skin of god.skins) {
        if (!skin) continue;
        if (!Array.isArray(skin.voiceTree)) skin.voiceTree = [];
        if (!Array.isArray(skin.announcerTree)) skin.announcerTree = [];
        if (!Array.isArray(skin.vgsDatabase)) skin.vgsDatabase = [];
      }
    }

    function normalizeDatabases() {
      godsDatabase.forEach((g) => {
        ensureDefaultSkinsAndVoiceData(g);
        ensureBoxIds(g.vgsDatabase);
        normalizeTree(g.voiceTree);
        normalizeTree(g.announcerTree);
        (g.skins || []).forEach((s) => {
          ensureBoxIds(s.vgsDatabase);
          normalizeTree(s.voiceTree);
          normalizeTree(s.announcerTree);
        });
      });
      ensureBoxIds(vgsDatabase);
    }

        function listAudios(obj) {
      if (!obj) return [];
      const raw = [];
      if (Array.isArray(obj.audios)) raw.push.apply(raw, obj.audios);
      if (obj.audioUrl) raw.push(obj.audioUrl);
      const out = [];
      raw.forEach((a) => {
        if (typeof a === 'string' && !isUselessAudio(a) && out.indexOf(a) === -1) out.push(a);
      });
      return out;
    }

    function getTierCssClass(tier) {
      const t = (tier || 'PADRÃO').toUpperCase();
      if (t === 'LIMITADO') return 'tier-limitado';
      if (t === 'UNLIMITED' || t === 'ILIMITADO') return 'tier-unlimited';
      if (t === 'CROSSOVER') return 'tier-crossover';
      if (t === 'CROSS-GEN') return 'tier-crossgen';
      if (t === 'PROMOCIONAL') return 'tier-promocional';
      if (t === 'EXCLUSIVO' || t === 'EXCLUSIVE') return 'tier-exclusivo';
      return 'tier-padrao';
    }

    async function loadStorageData() {
      let loaded = false;
      try {
        const state = await idbGet('meta', 'state');
        if (state && Array.isArray(state.godsDatabase) && state.godsDatabase.length) {
          godsDatabase = state.godsDatabase;
          vgsDatabase = Array.isArray(state.vgsDatabase) ? state.vgsDatabase : [];
          mainBgRef = state.mainBgRef || '';
          if (typeof state.audioVolume === 'number') audioVolume = state.audioVolume;
          loaded = true;
        }
      } catch (e) {}

      if (!loaded) {
        const savedGods = localStorage.getItem('smite_gods_db');
        if (savedGods) {
          try {
            const parsed = JSON.parse(savedGods);
            if (Array.isArray(parsed) && parsed.length > 0) godsDatabase = parsed;
            else godsDatabase = JSON.parse(JSON.stringify(defaultGodsDatabase));
          } catch (e) {
            godsDatabase = JSON.parse(JSON.stringify(defaultGodsDatabase));
          }
        } else {
          godsDatabase = JSON.parse(JSON.stringify(defaultGodsDatabase));
        }

        const savedVgs = localStorage.getItem('smite_vgs_db');
        if (savedVgs) {
          try {
            const parsedVgs = JSON.parse(savedVgs);
            if (Array.isArray(parsedVgs)) vgsDatabase = parsedVgs;
          } catch (e) {}
        }

        const legacyBg = localStorage.getItem('smite_main_bg');
        if (legacyBg && legacyBg.startsWith('data:')) mainBgRef = legacyBg;

        const vol = localStorage.getItem('smite_audio_volume');
        if (vol !== null && !isNaN(parseFloat(vol))) audioVolume = parseFloat(vol);

        try { await migrateInPlace(godsDatabase); } catch (e) {}
        try { await migrateInPlace(vgsDatabase); } catch (e) {}
        if (typeof mainBgRef === 'string' && mainBgRef.startsWith('data:')) {
          try { mainBgRef = await storeBlob(await (await fetch(mainBgRef)).blob()); } catch (e) { mainBgRef = ''; }
        }
      }

      normalizeDatabases();
      const refs = [];
      collectRefs(godsDatabase, refs);
      collectRefs(vgsDatabase, refs);
      if (mainBgRef) refs.push(mainBgRef);
      await Promise.all(refs.map((r) => ensureMedia(r).catch(() => '')));

      const savedVol = localStorage.getItem('smite_audio_volume');
      if (savedVol !== null && !isNaN(parseFloat(savedVol))) audioVolume = parseFloat(savedVol);

      if (!loaded) await saveStorageData();
      applyMainBg();
      applyVolumeUi();
    }

    async function saveStorageData() {
      normalizeDatabases();
      const state = {
        godsDatabase: godsDatabase,
        vgsDatabase: vgsDatabase,
        mainBgRef: mainBgRef || '',
        audioVolume: audioVolume
      };
      try {
        localStorage.setItem('smite_gods_db', JSON.stringify(godsDatabase));
        localStorage.setItem('smite_vgs_db', JSON.stringify(vgsDatabase));
        localStorage.setItem('smite_main_bg_ref', mainBgRef || '');
        localStorage.removeItem('smite_main_bg');
      } catch (e) {}
      try { await idbPut('meta', 'state', state); } catch (e) {}
    }

    function applyMainBg() {
      const el = document.getElementById('screenMain');
      if (!el) return;
      if (mainBgRef && mediaSync(mainBgRef)) {
        el.style.backgroundImage = 'linear-gradient(rgba(4,6,8,0.18), rgba(4,6,8,0.42)), ' + cssUrl(mainBgRef);
      } else {
        el.style.backgroundImage = '';
      }
    }

    function applyVolumeUi() {
      const slider = document.getElementById('audioVolumeSlider');
      const label = document.getElementById('volumeValText');
      const pct = Math.round(audioVolume * 100);
      if (slider) slider.value = String(pct);
      if (label) label.innerText = pct + '%';
    }

    async function uploadMainBg(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        mainBgRef = await storeBlob(file);
        applyMainBg();
        await saveStorageData();
      } catch (err) {
        alert('Não foi possível salvar o fundo. Tente outra imagem.');
      }
    }

    function openSection(mode) {
      currentMode = mode;
      hideAll();
      document.getElementById('smite-app').classList.remove('on-screen-main');
      document.getElementById('screenRoster').style.display = 'flex';
      document.getElementById('backBtn').style.display = 'flex';
      renderRoster();
      historyStack.push('roster');
    }

    function hideAll() {
      document.getElementById('screenMain').style.display = 'none';
      document.getElementById('screenRoster').style.display = 'none';
      document.getElementById('screenGodView').style.display = 'none';
      document.getElementById('screenVoicebankView').style.display = 'none';
    }

    function showScreen(name) {
      hideAll();
      const app = document.getElementById('smite-app');
      const back = document.getElementById('backBtn');
      if (name === 'main') {
        app.classList.add('on-screen-main');
        document.getElementById('screenMain').style.display = 'flex';
        back.style.display = 'none';
        return;
      }
      app.classList.remove('on-screen-main');
      back.style.display = 'flex';
      if (name === 'roster') {
        document.getElementById('screenRoster').style.display = 'flex';
        renderRoster();
      } else if (name === 'godView') {
        document.getElementById('screenGodView').style.display = 'grid';
        renderGodView();
      } else if (name === 'voicebankView') {
        document.getElementById('screenVoicebankView').style.display = 'block';
        renderVoicebankView();
        switchVPMode(currentVPMode || 'god');
      } else {
        showScreen('main');
      }
    }

    function handleBack() {
      if (historyStack.length <= 1) return;
      historyStack.pop();
      const last = historyStack[historyStack.length - 1];
      showScreen(last);
    }

    function renderRoster() {
      const grid = document.getElementById('rosterGrid');
      if (!grid) return;
      grid.innerHTML = '';
      const searchEl = document.getElementById('rosterSearch');
      const filter = searchEl ? searchEl.value.toLowerCase() : '';

      godsDatabase.forEach((god, idx) => {
        if (filter && !(god.name || '').toLowerCase().includes(filter)) return;
        const img = mediaSync(god.img);
        const container = document.createElement('div');
        container.className = 'god-card-container';
        container.innerHTML = `
          <button class="card-edit-btn edit-only" onclick="openGodModal(event, ${idx})"><img class="smite-action-icon" src="/smite-icons/S2_Stat_Passive.png" alt=""></button>
          <div class="smite-god-select-card" onclick="selectGod(${idx})">
            <div class="god-select-card-name">${escapeHtml(god.name)}</div>
          </div>
        `;
        const card = container.querySelector('.smite-god-select-card');
        if (img) {
          card.style.backgroundImage = 'linear-gradient(180deg, rgba(0,0,0,0.1) 40%, rgba(5,8,15,0.85) 100%), ' + cssUrl(god.img);
        }
        grid.appendChild(container);
      });
    }

    function selectGod(idx) {
      selectedGodIdx = idx;
      selectedSkinIdx = 0;
      currentGodTab = 'about';
      vgsFocusBoxId = null;
      hideAll();
      document.getElementById('smite-app').classList.remove('on-screen-main');

      if (currentMode === 'gods') {
        document.getElementById('screenGodView').style.display = 'grid';
        document.getElementById('backBtn').style.display = 'flex';
        renderGodView();
        historyStack.push('godView');
      } else {
        document.getElementById('screenVoicebankView').style.display = 'block';
        document.getElementById('backBtn').style.display = 'flex';
        renderVoicebankView();
        switchVPMode('god');
        historyStack.push('voicebankView');
      }
    }

    function goToVoicebankFromGod() {
      hideAll();
      document.getElementById('smite-app').classList.remove('on-screen-main');
      document.getElementById('screenVoicebankView').style.display = 'block';
      document.getElementById('backBtn').style.display = 'flex';
      renderVoicebankView();
      if (currentGodTab === 'skins') switchVPMode('skin');
      else switchVPMode('god');
      historyStack.push('voicebankView');
    }

    function setStageBg(ref, opts) {
      const stage = document.getElementById('godStage');
      if (!stage) return;

      const fade = !!(opts && opts.fade) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const token = ++stageFadeSeq;

      const paintNow = (url) => {
        if (token !== stageFadeSeq) return;
        const next = url
          ? 'linear-gradient(rgba(2,4,6,0.65), rgba(2,4,6,0.92)), url("' + String(url).replace(/"/g, '') + '")'
          : 'linear-gradient(rgba(2,4,6,0.65), rgba(2,4,6,0.92))';

        if (
          !stage.querySelector('.god-stage-crossfade') &&
          stage.style.backgroundImage === next
        ) {
          return;
        }

        if (!fade) {
          stage.style.backgroundImage = next;
          const layer = stage.querySelector('.god-stage-crossfade');
          if (layer) layer.remove();
          return;
        }
        if (!url) {
          stage.style.backgroundImage = next;
          return;
        }
        const img = new Image();
        let started = false;
        const startFade = () => {
          if (started || token !== stageFadeSeq) return;
          started = true;
          let layer = stage.querySelector('.god-stage-crossfade');
          if (!layer) {
            layer = document.createElement('div');
            layer.className = 'god-stage-crossfade';
            layer.setAttribute('aria-hidden', 'true');
            stage.insertBefore(layer, stage.firstChild);
          }
          layer.style.backgroundImage = next;
          layer.style.opacity = '0';
          requestAnimationFrame(() => {
            if (token !== stageFadeSeq) return;
            requestAnimationFrame(() => {
              if (token !== stageFadeSeq) return;
              layer.style.opacity = '1';
            });
          });
          let finished = false;
          const finish = () => {
            if (finished || token !== stageFadeSeq) return;
            finished = true;
            stage.style.backgroundImage = next;
            if (layer.parentNode) layer.remove();
          };
          layer.addEventListener('transitionend', (ev) => {
            if (ev.target === layer && ev.propertyName === 'opacity') finish();
          });
          setTimeout(finish, 520);
        };
        img.onload = startFade;
        img.onerror = () => {
          if (token !== stageFadeSeq) return;
          stage.style.backgroundImage = next;
          const layer = stage.querySelector('.god-stage-crossfade');
          if (layer) layer.remove();
        };
        img.src = url;
        if (img.complete && img.naturalWidth) startFade();
      };

      const cached = mediaSync(ref);
      if (cached || !ref || (typeof ref === 'string' && !ref.startsWith('idb:'))) {
        paintNow(cached);
        return;
      }
      ensureMedia(ref).then((url) => paintNow(url || ''));
    }

    function renderGodView() {
      const god = godsDatabase[selectedGodIdx];
      if (!god) return;
      document.getElementById('extGodName').innerText = god.name || '';
      document.getElementById('extGodTitle').innerText = god.title || '';
      document.getElementById('godLoreText').innerText = god.lore || '';
      document.getElementById('godMiniQuote').innerText = god.miniQuote || '';
      document.getElementById('godDifficulty').innerText = 'DIFICULDADE - ' + (god.difficulty || 'Média');

      document.getElementById('pantheonName').innerText = god.pantheon || 'Japonês';
      document.getElementById('typeName').innerText = god.type || 'Físico';
      document.getElementById('className').innerText = god.class || 'Caçador';

      const pImg = document.getElementById('pantheonImg');
      const tImg = document.getElementById('typeImg');
      const cImg = document.getElementById('classImg');
      if (pImg) pImg.src = mediaSync(god.pantheonImg) || '';
      if (tImg) tImg.src = mediaSync(god.typeImg) || '';
      if (cImg) cImg.src = mediaSync(god.classImg) || '';

      renderSkinsTab();
      switchGodTab(currentGodTab || 'about');
    }

    function switchGodTab(tab) {
      const god = godsDatabase[selectedGodIdx];
      if (!god) return;
      currentGodTab = tab;

      document.getElementById('tabBtnAbout').classList.remove('active');
      document.getElementById('tabBtnSkins').classList.remove('active');
      document.getElementById('tabBtnLore').classList.remove('active');

      document.getElementById('godTabAbout').style.display = 'none';
      document.getElementById('godTabSkins').style.display = 'none';
      document.getElementById('godTabLore').style.display = 'none';

      if (tab === 'about') {
        document.getElementById('tabBtnAbout').classList.add('active');
        document.getElementById('godTabAbout').style.display = 'flex';
        setStageBg(god.img);
      } else if (tab === 'skins') {
        document.getElementById('tabBtnSkins').classList.add('active');
        document.getElementById('godTabSkins').style.display = 'flex';
        // Recalcula a grade somente depois que a aba estiver visível.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const skinsGrid = document.getElementById('godSkinsGrid');
            if (skinsGrid) fitGodSkinsGrid(skinsGrid);
          });
        });
        const currentSkin = (god.skins && god.skins[selectedSkinIdx]) ? god.skins[selectedSkinIdx] : god;
        setStageBg(currentSkin.img || god.img);
      } else if (tab === 'lore') {
        document.getElementById('tabBtnLore').classList.add('active');
        document.getElementById('godTabLore').style.display = 'flex';
        setStageBg(god.img);
      }
    }

    function skinCardHtml(skin, idx, clickFn) {
      const isPadrao = !skin.tier || skin.tier.toUpperCase() === 'PADRÃO';
      const cssClass = getTierCssClass(skin.tier);
      const selected = idx === selectedSkinIdx ? ' is-selected' : '';
      return `
        <button class="card-edit-btn edit-only" onclick="openSkinModal(event, ${idx})"><img class="smite-action-icon" src="/smite-icons/S2_Stat_Passive.png" alt=""></button>
        <div class="smite-skin-card-wrapper">
          <div class="smite-skin-card${selected}" onclick="${clickFn}(${idx})">
            ${!isPadrao ? `<div class="skin-card-banner ${cssClass}"><span>${escapeHtml((skin.tier || '').toUpperCase())}</span></div>` : '<div></div>'}
          </div>
          <div class="skin-card-bottom-title">${escapeHtml(skin.name || '')}</div>
        </div>
      `;
    }

    function paintSkinCard(el, skin) {
      const card = el.querySelector('.smite-skin-card');
      if (!card) return;
      const url = cssUrl(skin.img);
      if (url) card.style.backgroundImage = 'linear-gradient(180deg, rgba(0,0,0,0.15) 30%, rgba(5,8,15,0.9) 100%), ' + url;
    }

    function fitGodSkinsGrid(grid) {
      // O layout da grade é controlado pelo CSS.
      // Não medir nem alterar dimensões durante rolagem ou troca de abas.
      return;
    }
    function renderSkinsTab() {
      const grid = document.getElementById('godSkinsGrid');
      if (!grid) return;

      const god = godsDatabase[selectedGodIdx];
      if (!god) {
        grid.innerHTML = '';
        return;
      }

      const defaultWasFirst = Array.isArray(god.skins) &&
        god.skins.length > 0 &&
        !!god.skins[0] &&
        (
          String(god.skins[0].name || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase() === 'PADRAO' ||
          god.skins[0].id === 'skin_default' ||
          god.skins[0].isDefault === true
        );

      // Garante a aparência padrão antes de desenhar os cartões.
      ensureDefaultSkinsAndVoiceData(god);

      // Persiste somente se a lista precisou ser corrigida ou reorganizada.
      if (!defaultWasFirst) {
        saveStorageData().catch(() => {});
      }

      grid.innerHTML = '';

      god.skins.forEach((skin, idx) => {
        if (!skin) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'god-card-container';
        wrapper.innerHTML = skinCardHtml(skin, idx, 'applySkinBackground');
        paintSkinCard(wrapper, skin);
        grid.appendChild(wrapper);
      });

      const fit = () => fitGodSkinsGrid(grid);
      requestAnimationFrame(fit);

      if (grid.dataset.fitRowsResizeBound !== 'true') {
        grid.dataset.fitRowsResizeBound = 'true';
        window.addEventListener('resize', () => requestAnimationFrame(fit));
      }
    }

    function applySkinBackground(idx) {
      const god = godsDatabase[selectedGodIdx];
      const skin = god && god.skins ? god.skins[idx] : null;
      if (!skin) return;

      const grid = document.getElementById('godSkinsGrid');
      if (grid) {
        const cards = grid.querySelectorAll('.smite-skin-card');
        cards.forEach((card) => {
          card.classList.remove('is-selected');
        });

        const containers = grid.querySelectorAll('.god-card-container');
        const container = containers[idx];
        const selectedCard = container
          ? container.querySelector('.smite-skin-card')
          : null;

        if (selectedCard) selectedCard.classList.add('is-selected');
      }

      selectedSkinIdx = idx;
      setStageBg(skin.img, { fade: true });
    }

    function renderVoicebankView() {
      const god = godsDatabase[selectedGodIdx];
      if (!god) return;
      const currentSkin = (god.skins && god.skins[selectedSkinIdx]) ? god.skins[selectedSkinIdx] : null;
      const titleEl = document.getElementById('vpTitle');
      const imgEl = document.getElementById('vpImage');
      if (titleEl) {
        titleEl.innerText = currentSkin && (currentSkin.name || '').toUpperCase() !== 'PADRÃO' && (currentSkin.name || '').toUpperCase() !== 'PADRAO'
          ? currentSkin.name
          : god.name;
      }
      if (imgEl) imgEl.src = mediaSync(currentSkin ? currentSkin.img : god.img) || '';
      const dubberEl = document.getElementById('vpDubber');
      const releaseEl = document.getElementById('vpReleaseDate');
      if (dubberEl) dubberEl.innerText = currentSkin
        ? (currentSkin.dubber || god.dubber || '')
        : (god.dubber || '');
      if (releaseEl) releaseEl.innerText = currentSkin
        ? (currentSkin.releaseDate || god.releaseDate || '')
        : (god.releaseDate || '');
      refreshVpGodButtonLabel();
    }

    function refreshVpGodButtonLabel() {
      const god = godsDatabase[selectedGodIdx];
      const hasSkinSelected = god && selectedSkinIdx >= 0 && god.skins && god.skins[selectedSkinIdx];
      const btnGodElem = document.getElementById('btnVpGod');
      if (btnGodElem) btnGodElem.innerText = hasSkinSelected ? 'VOZ DA APARÊNCIA' : 'VOZ DO DEUS';
    }

    function openVpHeaderModal() {
      const god = godsDatabase[selectedGodIdx];
      const currentSkin = (god.skins && god.skins[selectedSkinIdx]) ? god.skins[selectedSkinIdx] : null;
      document.getElementById('modalVpDubber').value = currentSkin ? (currentSkin.dubber || '') : (god.dubber || '');
      document.getElementById('modalVpReleaseDate').value = currentSkin ? (currentSkin.releaseDate || '') : (god.releaseDate || '');
      document.getElementById('vpHeaderModal').style.display = 'flex';
    }

    async function saveVpHeaderModal() {
      const god = godsDatabase[selectedGodIdx];
      const currentSkin = (god.skins && god.skins[selectedSkinIdx]) ? god.skins[selectedSkinIdx] : null;
      const dub = document.getElementById('modalVpDubber').value;
      const relDate = document.getElementById('modalVpReleaseDate').value;
      if (currentSkin) {
        currentSkin.dubber = dub;
        currentSkin.releaseDate = relDate;
      } else {
        god.dubber = dub;
        god.releaseDate = relDate;
      }
      await saveStorageData();
      renderVoicebankView();
      closeModal('vpHeaderModal');
    }


    function switchVPMode(mode) {
      currentVPMode = mode;
      document.querySelectorAll('.wiki-btn-menu').forEach((b) => b.classList.remove('active'));
      refreshVpGodButtonLabel();

      const btnMap = {
        god: 'btnVpGod',
        skin: 'btnVpSkin',
        announcer: 'btnVpAnnouncer',
        vgs: 'btnVpVGS'
      };

      if (btnMap[mode]) {
        const btn = document.getElementById(btnMap[mode]);
        if (btn) btn.classList.add('active');
      }

      const vgsGroup = document.getElementById('vgsContainerGroup');
      const panel = document.getElementById('vpDynamicPanel');
      const skinPanel = document.getElementById('vpSkinSelectionPanel');
      const editBtn = document.getElementById('globalPageEditBtn');

      if (skinPanel) skinPanel.style.display = 'block';
      if (skinPanel) renderVpSkinCardsPanel();
      if (editBtn) editBtn.style.display = ['god', 'skin', 'announcer', 'vgs'].includes(mode) ? 'flex' : 'none';

      if (mode === 'vgs') {
        if (vgsGroup) vgsGroup.style.display = 'flex';
        if (panel) panel.style.display = 'none';
        renderVgsWikiTables();
        return;
      }

      if (vgsGroup) vgsGroup.style.display = 'none';

      if (mode === 'skin') {
        if (panel) panel.style.display = 'none';
        return;
      }

      if (panel) panel.style.display = 'block';
      renderVoiceTreePanel();
    }

    function renderVoiceTreePanel() {
      const god = godsDatabase[selectedGodIdx];
      if (!god) return;
      const hasSkinSelected = (selectedSkinIdx >= 0 && god.skins && god.skins[selectedSkinIdx]);
      const currentSkin = hasSkinSelected ? god.skins[selectedSkinIdx] : null;
      const targetName = currentSkin ? currentSkin.name.toUpperCase() : god.name;
      const container = document.getElementById('voiceTreeContainer');
      if (!container) return;
      container.innerHTML = '';

      if (currentVPMode === 'god') {
        document.getElementById('vpSectionTitle').innerText = hasSkinSelected ? `FALAS DE ${targetName} (APARÊNCIA)` : `FALAS DE ${targetName}`;
        renderTreeNodes(getActiveTree(), container);
      } else if (currentVPMode === 'announcer') {
        document.getElementById('vpSectionTitle').innerText = `PACOTE DE LOCUTOR DE ${targetName}`;
        renderTreeNodes(getActiveTree(), container);
      }
    }

    function audioButtonsHtml(obj, label) {
      const audios = listAudios(obj);
      if (!audios.length) return '';
      return `<div class="vgs-audio-btns">${audios.map((ref, i) => {
        const lab = audios.length > 1 ? `${label} (${i + 1})` : label;
        return `<button type="button" class="vgs-play-double-btn" data-audio-ref="${escapeHtml(ref)}" data-audio-label="${escapeHtml(lab)}" title="Reproduzir áudio ${i + 1}" aria-label="Reproduzir áudio ${i + 1}">
          <svg class="smite-audio-speaker" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/>
            <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>`;
      }).join('')}</div>`;
    }

    function renderTreeNodes(nodes, containerElement) {
      (nodes || []).forEach((node) => {
        if (node.type === 'category') {
          const catBox = document.createElement('div');
          catBox.className = 'tree-category-box';
          catBox.innerHTML = `
            <div class="tree-category-title">
              <span>${escapeHtml(node.title || '')}</span>
              <button class="smite-btn-sm edit-only" onclick="openTreeModalForEdit('${node.id}')"><img class="smite-action-icon" src="/smite-icons/S2_Stat_Passive.png" alt=""></button>
            </div>
            <div class="category-children-container" id="container_${node.id}"></div>
          `;
          containerElement.appendChild(catBox);
          if (node.children) renderTreeNodes(node.children, catBox.querySelector('#container_' + node.id));
        } else if (node.type === 'subcategory') {
          const subBox = document.createElement('div');
          subBox.className = 'tree-subcategory-box';
          subBox.innerHTML = `
            <div class="tree-subcategory-title">
              <span>${escapeHtml(node.title || '')}</span>
              <button class="smite-btn-sm edit-only" onclick="openTreeModalForEdit('${node.id}')"><img class="smite-action-icon" src="/smite-icons/S2_Stat_Passive.png" alt=""></button>
            </div>
            <div class="subcategory-children-container" id="container_${node.id}"></div>
          `;
          containerElement.appendChild(subBox);
          if (node.children) renderTreeNodes(node.children, subBox.querySelector('#container_' + node.id));
        } else if (node.type === 'line') {
          if (!node.text && (!node.title || node.title.trim() === '')) return;
          const lineCard = document.createElement('div');
          lineCard.className = 'voice-line-item';
          const hasTitle = node.title && node.title.trim() !== '' && node.title.toLowerCase() !== 'sem título';
          const label = speechLabel(hasTitle ? node.title : node.text);
          lineCard.innerHTML = `
            <div>
              ${hasTitle ? `<div style="color:var(--wiki-gold-title); font-size:0.88rem;">${escapeHtml(node.title)}</div>` : ''}
              <div style="font-size:0.85rem; color:#cbd5e1; white-space:pre-wrap;">${escapeHtml(node.text || '')}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              ${audioButtonsHtml(node, label)}
              <button class="smite-btn-sm edit-only" onclick="openTreeModalForEdit('${node.id}')"><img class="smite-action-icon" src="/smite-icons/S2_Stat_Passive.png" alt=""></button>
            </div>
          `;
          containerElement.appendChild(lineCard);
        }
      });
    }

    function renderVpSkinCardsPanel() {
      const god = godsDatabase[selectedGodIdx];
      const grid = document.getElementById('vpSkinCardsGrid');
      if (!grid || !god) return;

      // Garante que a aparência padrão exista antes de montar os cartões.
      const skinsBefore = JSON.stringify(god.skins || []);
      ensureDefaultSkinsAndVoiceData(god);
      const skinsAfter = JSON.stringify(god.skins || []);

      // Persiste a normalização somente quando houve alteração.
      if (skinsBefore !== skinsAfter) {
        saveStorageData().catch(() => {});
      }

      grid.innerHTML = '';
      (god.skins || []).forEach((skin, idx) => {
        if (!skin) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'god-card-container';
        wrapper.innerHTML = skinCardHtml(skin, idx, 'selectVpSkinCard');
        paintSkinCard(wrapper, skin);
        grid.appendChild(wrapper);
      });
    }


    function selectVpSkinCard(idx) {
      const god = godsDatabase[selectedGodIdx];
      if (!god || !god.skins || !god.skins[idx]) return;

      selectedSkinIdx = idx;
      renderVoicebankView();
      renderVpSkinCardsPanel();

      if (currentVPMode === 'vgs') {
        renderVgsWikiTables();
      } else if (currentVPMode === 'god' || currentVPMode === 'announcer') {
        renderVoiceTreePanel();
      }
    }

        function getActiveVgs() {
      const god = godsDatabase[selectedGodIdx];
      if (!god) return [];
      const hasSkinSelected = (selectedSkinIdx >= 0 && god.skins && god.skins[selectedSkinIdx]);
      const targetObj = (god.skins && god.skins[selectedSkinIdx])
          ? god.skins[selectedSkinIdx]
          : god;
      if (!targetObj.vgsDatabase) {
        targetObj.vgsDatabase = [
          {
            id: 'vgsbox_default',
            boxTitle: 'VV - Other',
            rows: [
              { code: 'G', result: 'General', isCategory: true, audioUrl: '', audios: [], linkBoxId: '' },
              { code: 'V', result: 'Position', isCategory: true, audioUrl: '', audios: [], linkBoxId: '' },
              { code: 'A', result: 'Ok!', isCategory: false, audioUrl: '', audios: [], linkBoxId: '' },
              { code: 'B', result: 'Be right back!', isCategory: false, audioUrl: '', audios: [], linkBoxId: '' }
            ]
          }
        ];
      }
      ensureBoxIds(targetObj.vgsDatabase);
      return targetObj.vgsDatabase;
    }

    function renderVgsWikiTables() {
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains('vgs-editable') && active.isContentEditable) {
        vgsRenderPending = true;
        return;
      }
      vgsRenderPending = false;
      const container = document.getElementById('vgsTablesList');
      if (!container) return;
      container.innerHTML = '';
      const all = getActiveVgs();

      if (vgsFocusBoxId && !all.some((b) => b.id === vgsFocusBoxId)) vgsFocusBoxId = null;

      if (vgsFocusBoxId) {
        const focused = all.find((b) => b.id === vgsFocusBoxId);
        const bar = document.createElement('div');
        bar.className = 'vgs-focus-bar';
        bar.innerHTML = `<button type="button" class="smite-btn-sm" onclick="clearVgsFocus()">◄ Voltar</button><span style="color:var(--wiki-gold-title);">${escapeHtml(focused ? focused.boxTitle : '')}</span>`;
        container.appendChild(bar);
      }

      all.forEach((box, boxIdx) => {
        if (vgsFocusBoxId && box.id !== vgsFocusBoxId) return;
        const wikiBox = document.createElement('div');
        const audiosPresent = (box.rows || []).some((r) => listAudios(r).length > 0);
        let rowsHtml = '';
        if (box.rows && box.rows.length > 0) {
          box.rows.forEach((row, rowIdx) => {
            const codeClass = row.isCategory ? 'vgs-code-cell is-cat-code' : 'vgs-code-cell';
            const resultCellClass = row.isCategory ? 'vgs-outcome-cell is-category-result' : 'vgs-outcome-cell';
            const editableCode = isEditMode ? 'true' : 'false';
            const linked = !!(row.isCategory && row.linkBoxId);
            const editableResult = isEditMode ? 'true' : 'false';
            const linkCls = linked ? ' is-link' : '';
            const linkAttr = row.linkBoxId ? ` data-link-box="${escapeHtml(row.linkBoxId)}"` : '';
            const linkTitle = row.linkBoxId ? ' title="Abre outra caixa de comandos"' : '';
            const play = audioButtonsHtml(row, speechLabel(row.result));
            const third = audiosPresent ? `<td style="width:70px; text-align:center;">${play}</td>` : '';
            rowsHtml += `
              <tr>
                <td class="${codeClass}">
                  <div class="vgs-editable" contenteditable="${editableCode}" data-box="${boxIdx}" data-row="${rowIdx}" data-field="code">${escapeHtml(row.code || '')}</div>
                </td>
                <td class="${resultCellClass}" ${audiosPresent ? '' : 'colspan="2"'}>
                  <div class="vgs-editable${linkCls}" contenteditable="${editableResult}" data-box="${boxIdx}" data-row="${rowIdx}" data-field="result"${linkAttr}${linkTitle}>${escapeHtml(row.result || '')}</div>
                </td>
                ${third}
                <td class="edit-only" style="width: 35px; text-align:center;">
                  <button type="button" style="background:none; border:none; color:var(--wiki-blue-text); cursor:pointer;" onclick="openVgsModalForEdit(${boxIdx}, ${rowIdx})"><img class="smite-action-icon" src="/smite-icons/S2_Stat_Passive.png" alt=""></button>
                </td>
              </tr>
            `;
          });
        } else {
          rowsHtml = `<tr><td colspan="4" style="text-align:center; color:#8392A5; padding: 15px;">Nenhum comando adicionado. Clique no lápis do cabeçalho para adicionar.</td></tr>`;
        }

        const thThird = audiosPresent ? '<th style="width:70px; text-align:center;"></th>' : '';
        wikiBox.innerHTML = `
          <div class="vgs-outside-title">
            <span>${escapeHtml(box.boxTitle || 'VGS')} <button type="button" style="background:none; border:none; color:var(--wiki-blue-text); font-size:0.9rem; cursor:pointer;" onclick="openVgsBoxTitleModal(${boxIdx})" class="edit-only"><img class="smite-action-icon" src="/smite-icons/S2_Stat_Passive.png" alt=""></button></span>
          </div>
          <div class="vgs-wiki-box">
            <table class="vgs-wiki-table">
              <thead>
                <tr>
                  <th style="width: 90px; text-align:center;">VGS</th>
                  <th style="text-align:center;" ${audiosPresent ? '' : 'colspan="2"'}>Outcome</th>
                  ${thThird}
                  <th class="edit-only" style="width: 35px; text-align:center;">
                    <button type="button" style="background:none; border:none; color:var(--wiki-blue-text); font-size:0.9rem; cursor:pointer;" onclick="openVgsModalForEdit(${boxIdx}, null)" title="Adicionar Linha">+</button>
                  </th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        `;
        container.appendChild(wikiBox);
      });
    }

    function readVgsEditable(el) {
      return (el.innerText || '').replace(/\u00a0/g, ' ');
    }

    function scheduleVgsSave() {
      clearTimeout(vgsSaveTimer);
      vgsSaveTimer = setTimeout(() => { saveStorageData(); }, 200);
    }

    function commitVgsCell(el) {
      const boxIdx = Number(el.dataset.box);
      const rowIdx = Number(el.dataset.row);
      const field = el.dataset.field;
      const list = getActiveVgs();
      const row = list[boxIdx] && list[boxIdx].rows && list[boxIdx].rows[rowIdx];
      if (!row || (field !== 'code' && field !== 'result')) return;
      let val = readVgsEditable(el);
      const focused = document.activeElement === el;
      if (field === 'code') {
        row.code = focused ? val : val.replace(/\s+/g, '').toUpperCase();
        if (!focused) {
          const shown = row.code;
          if (el.textContent !== shown) el.textContent = shown;
        }
      } else {
        row.result = stripWrappingQuotes(val.replace(/\n+$/g, ''));
      }
      if (focused) scheduleVgsSave();
      else {
        clearTimeout(vgsSaveTimer);
        saveStorageData();
      }
    }

    function flushPendingVgsRender() {
      if (!vgsRenderPending) return;
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains('vgs-editable') && active.isContentEditable) return;
      renderVgsWikiTables();
    }

    function clearVgsFocus() {
      vgsFocusBoxId = null;
      renderVgsWikiTables();
    }

    function jumpToVgsBox(id) {
      if (!id) return;
      const all = getActiveVgs();
      if (!all.some((b) => b.id === id)) return;
      vgsFocusBoxId = id;
      renderVgsWikiTables();
      const el = document.getElementById('vgsTablesList');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function handleGlobalEditClick() {
      if (currentVPMode === 'vgs') {
        const vgsList = getActiveVgs();
        openVgsModalForEdit(vgsList.length, null);
      } else if (currentVPMode === 'god' || currentVPMode === 'announcer') {
        openTreeModalForAdd();
      } else if (currentVPMode === 'skin') {
        openSkinModal(null, null);
      }
    }

    function renderPendingAudios(containerId) {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!pendingAudios.length) {
        el.innerHTML = '';
        return;
      }
      el.innerHTML = pendingAudios.map((ref, i) => `
        <div class="audio-chip">
          <button type="button" class="vgs-play-double-btn" data-audio-ref="${escapeHtml(ref)}" data-audio-label="${escapeHtml('Áudio ' + (i + 1))}">▶️</button>
          <span>Áudio ${i + 1}</span>
          <button type="button" class="smite-btn-danger" onclick="removePendingAudio(${i}, '${containerId}')" title="Remover áudio"><img class="smite-action-icon" src="/smite-icons/S2_Complete_X.png" alt=""></button>
        </div>
      `).join('');
    }

    function removePendingAudio(index, containerId) {
      pendingAudios.splice(index, 1);
      renderPendingAudios(containerId);
    }

    async function onVgsAudioPicked(e) {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      audioBusy = true;
      try {
        for (let i = 0; i < files.length; i++) pendingAudios.push(await storeBlob(files[i]));
        renderPendingAudios('vgsAudioList');
      } catch (err) {
        alert('Não foi possível adicionar o áudio.');
      } finally {
        audioBusy = false;
      }
    }

    async function onTreeAudioPicked(e) {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      audioBusy = true;
      try {
        for (let i = 0; i < files.length; i++) pendingAudios.push(await storeBlob(files[i]));
        renderPendingAudios('treeAudioList');
      } catch (err) {
        alert('Não foi possível adicionar o áudio.');
      } finally {
        audioBusy = false;
      }
    }

    function toggleVgsCategoryFields() {
      const isCat = document.getElementById('modalVgsIsCat').value === 'true';
      const rowMode = editingVgsMode === 'new-row' || editingVgsMode === 'edit-row';
      const group = document.getElementById('groupVgsLink');
      if (group) group.style.display = rowMode && isCat ? 'flex' : 'none';
      if (rowMode && isCat) {
        populateVgsLinkSelect(document.getElementById('modalVgsLinkBox').value);
      }
    }


    function populateVgsLinkSelect(selectedId) {
      const select = document.getElementById('modalVgsLinkBox');
      if (!select) return;
      const list = getActiveVgs();
      const current = list[editingVgsBoxIdx];
      const currentId = current && current.id;
      select.innerHTML = '<option value="">Não levar a nenhuma caixa</option>';
      list.forEach((box) => {
        if (!box.id || box.id === currentId) return;
        const opt = document.createElement('option');
        opt.value = box.id;
        opt.textContent = box.boxTitle || 'VGS';
        select.appendChild(opt);
      });
      const want = selectedId || '';
      select.value = Array.from(select.options).some((o) => o.value === want) ? want : '';
    }

    function setVgsModalMode(mode) {
      editingVgsMode = mode;
      const titleMode = mode === 'new-box' || mode === 'edit-box-title';
      const rowMode = mode === 'new-row' || mode === 'edit-row';

      const titleGroup = document.getElementById('vgsTitleFieldGroup');
      const rowHeading = document.getElementById('vgsRowSectionTitle');
      const rowGroups = [
        'vgsCodeFieldGroup',
        'vgsResultFieldGroup',
        'vgsCategoryFieldGroup',
        'vgsAudioFieldGroup'
      ];

      if (titleGroup) titleGroup.style.display = titleMode ? '' : 'none';
      if (rowHeading) rowHeading.style.display = rowMode ? '' : 'none';
      rowGroups.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = rowMode ? '' : 'none';
      });

      const linkGroup = document.getElementById('groupVgsLink');
      if (linkGroup && titleMode) linkGroup.style.display = 'none';
    }

    function openVgsBoxTitleModal(boxIdx) {
      const vgsList = getActiveVgs();
      const targetBox = vgsList[boxIdx];
      if (!targetBox) return;

      editingVgsBoxIdx = boxIdx;
      editingVgsRowIdx = null;
      setVgsModalMode('edit-box-title');

      document.getElementById('modalVgsBoxTitle').value = targetBox.boxTitle || 'VGS';
      document.getElementById('modalVgsCode').value = '';
      document.getElementById('modalVgsResult').value = '';
      document.getElementById('modalVgsIsCat').value = 'false';
      document.getElementById('btnDeleteEntireVgsBox').style.display = 'inline-flex';
      document.getElementById('btnDeleteVgsRow').style.display = 'none';

      const fileInput = document.getElementById('modalVgsAudioFile');
      if (fileInput) fileInput.value = '';

      pendingAudios = [];
      populateVgsLinkSelect('');
      toggleVgsCategoryFields();
      renderPendingAudios('vgsAudioList');
      document.getElementById('editVgsModal').style.display = 'flex';
    }

    function openVgsModalForEdit(boxIdx, rowIdx) {
      const vgsList = getActiveVgs();
      const creatingBox = boxIdx !== null && boxIdx >= vgsList.length;

      if (!creatingBox && (boxIdx === null || boxIdx >= vgsList.length)) {
        boxIdx = 0;
      }

      editingVgsBoxIdx = creatingBox ? vgsList.length : boxIdx;

      const targetBox = creatingBox
        ? { boxTitle: 'NOVA CAIXA VGS', rows: [] }
        : vgsList[boxIdx];

      const validRow = !creatingBox &&
        rowIdx !== null &&
        rowIdx !== undefined &&
        targetBox.rows &&
        targetBox.rows[rowIdx];

      const mode = creatingBox ? 'new-box' : (validRow ? 'edit-row' : 'new-row');
      editingVgsRowIdx = mode === 'edit-row' ? rowIdx : null;
      setVgsModalMode(mode);

      document.getElementById('modalVgsBoxTitle').value = targetBox.boxTitle || 'VGS';
      document.getElementById('btnDeleteEntireVgsBox').style.display =
        creatingBox ? 'none' : 'inline-flex';

      const fileInput = document.getElementById('modalVgsAudioFile');
      if (fileInput) fileInput.value = '';

      if (mode === 'edit-row') {
        const row = targetBox.rows[rowIdx];
        document.getElementById('modalVgsCode').value = row.code || '';
        document.getElementById('modalVgsResult').value = row.result || '';
        document.getElementById('modalVgsIsCat').value = row.isCategory ? 'true' : 'false';
        document.getElementById('btnDeleteVgsRow').style.display = 'inline-flex';
        pendingAudios = listAudios(row).slice();
        populateVgsLinkSelect(row.linkBoxId || '');
      } else {
        document.getElementById('modalVgsCode').value = '';
        document.getElementById('modalVgsResult').value = '';
        document.getElementById('modalVgsIsCat').value = 'false';
        document.getElementById('btnDeleteVgsRow').style.display = 'none';
        pendingAudios = [];
        populateVgsLinkSelect('');
      }

      toggleVgsCategoryFields();
      renderPendingAudios('vgsAudioList');
      document.getElementById('editVgsModal').style.display = 'flex';
    }


    async function deleteEntireVgsBox() {
      const vgsList = getActiveVgs();
      if (editingVgsBoxIdx !== null && editingVgsBoxIdx < vgsList.length) {
        const removed = vgsList[editingVgsBoxIdx];
        vgsList.splice(editingVgsBoxIdx, 1);
        if (removed && removed.id === vgsFocusBoxId) vgsFocusBoxId = null;
        await saveStorageData();
        renderVgsWikiTables();
        closeModal('editVgsModal');
      }
    }

    async function saveVgsModal() {
      while (audioBusy) await new Promise((r) => setTimeout(r, 40));

      const vgsList = getActiveVgs();
      const titleInput =
        document.getElementById('modalVgsBoxTitle').value.trim() || 'VGS';

      if (editingVgsMode === 'edit-box-title') {
        const box = vgsList[editingVgsBoxIdx];
        if (!box) return;
        box.boxTitle = titleInput;
        await saveStorageData();
        renderVgsWikiTables();
        closeModal('editVgsModal');
        return;
      }

      if (editingVgsMode === 'new-box') {
        vgsList.push({
          id: 'vgsbox_' + Date.now().toString(36),
          boxTitle: titleInput,
          rows: []
        });
        await saveStorageData();
        renderVgsWikiTables();
        closeModal('editVgsModal');
        return;
      }

      const targetBox = vgsList[editingVgsBoxIdx];
      if (!targetBox) {
        alert('A caixa VGS não foi encontrada. Nenhuma alteração foi salva.');
        return;
      }

      const code = document.getElementById('modalVgsCode').value.trim().toUpperCase();
      const result = document.getElementById('modalVgsResult').value.replace(/\n+$/g, '');
      const isCat = document.getElementById('modalVgsIsCat').value === 'true';
      const linkBoxId = isCat
        ? (document.getElementById('modalVgsLinkBox').value || '')
        : '';

      if (!targetBox.rows) targetBox.rows = [];

      if (editingVgsMode === 'edit-row') {
        const row = targetBox.rows[editingVgsRowIdx];
        if (!row) {
          alert('A linha VGS não foi encontrada. Nenhuma alteração foi salva.');
          return;
        }

        row.code = code;
        row.result = result;
        row.isCategory = isCat;
        row.linkBoxId = linkBoxId;
        row.audios = pendingAudios.slice();
        row.audioUrl = row.audios[0] || '';
      } else {
        targetBox.rows.push({
          code,
          result,
          isCategory: isCat,
          linkBoxId,
          audios: pendingAudios.slice(),
          audioUrl: pendingAudios[0] || ''
        });
      }

      await saveStorageData();
      renderVgsWikiTables();
      closeModal('editVgsModal');
    }


    async function deleteVgsRow() {
      const vgsList = getActiveVgs();
      if (editingVgsBoxIdx !== null && editingVgsRowIdx !== null && vgsList[editingVgsBoxIdx]) {
        vgsList[editingVgsBoxIdx].rows.splice(editingVgsRowIdx, 1);
        await saveStorageData();
        renderVgsWikiTables();
        closeModal('editVgsModal');
      }
    }

    function getActiveTree() {
      const god = godsDatabase[selectedGodIdx];
      const hasSkinSelected = (selectedSkinIdx >= 0 && god.skins && god.skins[selectedSkinIdx]);
      const targetObj = (god.skins && god.skins[selectedSkinIdx])
          ? god.skins[selectedSkinIdx]
          : god;
      if (currentVPMode === 'announcer') {
        if (!targetObj.announcerTree) targetObj.announcerTree = [];
        return targetObj.announcerTree;
      }
      if (!targetObj.voiceTree) targetObj.voiceTree = [];
      return targetObj.voiceTree;
    }

    function openTreeModalForAdd() {
      editingTreeTarget = null;
      pendingAudios = [];
      document.getElementById('modalTreeType').value = 'line';
      document.getElementById('modalTreeTitle').value = '';
      document.getElementById('modalTreeText').value = '';
      document.getElementById('btnDeleteTreeItem').style.display = 'none';
      const fileInput = document.getElementById('modalTreeAudioFile');
      if (fileInput) fileInput.value = '';
      populateParentDropdown();
      toggleTreeModalFields();
      renderPendingAudios('treeAudioList');
      document.getElementById('voiceCategoryLineModal').style.display = 'flex';
    }

    function openTreeModalForEdit(nodeId) {
      const tree = getActiveTree();
      const node = findNodeInTree(tree, nodeId);
      if (!node) return;
      editingTreeTarget = node;
      pendingAudios = listAudios(node).slice();
      document.getElementById('modalTreeType').value = node.type;
      document.getElementById('modalTreeTitle').value = node.title || '';
      document.getElementById('modalTreeText').value = node.text || '';
      document.getElementById('btnDeleteTreeItem').style.display = 'inline-flex';
      const fileInput = document.getElementById('modalTreeAudioFile');
      if (fileInput) fileInput.value = '';
      populateParentDropdown(nodeId);
      toggleTreeModalFields();
      renderPendingAudios('treeAudioList');
      document.getElementById('voiceCategoryLineModal').style.display = 'flex';
    }

    function toggleTreeModalFields() {
      const type = document.getElementById('modalTreeType').value;
      if (type === 'line') {
        document.getElementById('groupTreeTitle').style.display = 'flex';
        document.getElementById('labelTreeTitle').innerText = 'Título da Fala:';
        document.getElementById('groupTreeText').style.display = 'flex';
        document.getElementById('groupTreeParent').style.display = 'flex';
        document.getElementById('groupTreeAudio').style.display = 'flex';
      } else if (type === 'category') {
        document.getElementById('groupTreeTitle').style.display = 'flex';
        document.getElementById('labelTreeTitle').innerText = 'Nome da Categoria:';
        document.getElementById('groupTreeText').style.display = 'none';
        document.getElementById('groupTreeParent').style.display = 'none';
        document.getElementById('groupTreeAudio').style.display = 'none';
      } else if (type === 'subcategory') {
        document.getElementById('groupTreeTitle').style.display = 'flex';
        document.getElementById('labelTreeTitle').innerText = 'Nome da Subcategoria:';
        document.getElementById('groupTreeText').style.display = 'none';
        document.getElementById('groupTreeParent').style.display = 'flex';
        document.getElementById('groupTreeAudio').style.display = 'none';
      }
    }

    function populateParentDropdown(excludeId) {
      const select = document.getElementById('modalTreeParentSelect');
      select.innerHTML = '<option value="root">-- Raiz (Sem Pai) --</option>';
      const tree = getActiveTree();
      function walk(nodes, depth) {
        nodes.forEach((n) => {
          if (n.id === excludeId) return;
          if (n.type === 'category' || n.type === 'subcategory') {
            const prefix = '--'.repeat(depth || 0);
            const opt = document.createElement('option');
            opt.value = n.id;
            opt.innerText = `${prefix} ${n.title} (${n.type})`;
            select.appendChild(opt);
            if (n.children) walk(n.children, (depth || 0) + 1);
          }
        });
      }
      walk(tree, 0);
      if (editingTreeTarget) {
        const parent = findParentNodeInTree(tree, editingTreeTarget.id);
        if (parent) select.value = parent.id;
      }
    }

    async function saveTreeModal() {
      while (audioBusy) await new Promise((r) => setTimeout(r, 40));
      const tree = getActiveTree();
      const type = document.getElementById('modalTreeType').value;
      const title = document.getElementById('modalTreeTitle').value.trim();
      const text = stripWrappingQuotes(document.getElementById('modalTreeText').value);
      const parentId = document.getElementById('modalTreeParentSelect').value;

      if (type === 'line' && !text) {
        alert('Por favor, insira o texto da fala.');
        return;
      }
      if ((type === 'category' || type === 'subcategory') && !title) {
        alert('Por favor, insira o título.');
        return;
      }

      const applyAudios = (node) => {
        if (type === 'line') {
          node.audios = pendingAudios.slice();
          node.audioUrl = node.audios[0] || '';
        }
      };

      if (editingTreeTarget) {
        const originalParent = findParentNodeInTree(tree, editingTreeTarget.id);
        const originalList = originalParent ? originalParent.children : tree;
        const originalIndex = originalList
          ? originalList.findIndex((item) => item.id === editingTreeTarget.id)
          : -1;
        const originalParentId = originalParent ? originalParent.id : 'root';

        editingTreeTarget.type = type;
        editingTreeTarget.title = title;
        editingTreeTarget.text = text;
        applyAudios(editingTreeTarget);

        if (parentId === originalParentId && originalIndex >= 0) {
          // Mesmo pai: atualizar sem remover ou mover o item.
          originalList[originalIndex] = editingTreeTarget;
        } else {
          // Pai alterado: remover da posição anterior e inserir no novo destino.
          removeNodeFromTree(tree, editingTreeTarget.id);
          if (parentId !== 'root') {
            const pNode = findNodeInTree(tree, parentId);
            if (pNode) {
              if (!pNode.children) pNode.children = [];
              pNode.children.push(editingTreeTarget);
            } else tree.push(editingTreeTarget);
          } else {
            tree.push(editingTreeTarget);
          }
        }
      } else {
        const newNode = {
          id: 'node_' + Date.now(),
          type: type,
          title: title,
          text: text,
          children: [],
          audioUrl: '',
          audios: []
        };
        applyAudios(newNode);
        if (parentId === 'root') tree.push(newNode);
        else {
          const pNode = findNodeInTree(tree, parentId);
          if (pNode) {
            if (!pNode.children) pNode.children = [];
            pNode.children.push(newNode);
          } else tree.push(newNode);
        }
      }

      await saveStorageData();
      renderVoiceTreePanel();
      closeModal('voiceCategoryLineModal');
    }

    async function deleteTreeItem() {
      if (!editingTreeTarget) return;
      const tree = getActiveTree();
      removeNodeFromTree(tree, editingTreeTarget.id);
      await saveStorageData();
      renderVoiceTreePanel();
      closeModal('voiceCategoryLineModal');
    }

    function findNodeInTree(nodes, id) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.id === id) return n;
        if (n.children) {
          const found = findNodeInTree(n.children, id);
          if (found) return found;
        }
      }
      return null;
    }

    function findParentNodeInTree(nodes, id) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.children && n.children.some((c) => c.id === id)) return n;
        if (n.children) {
          const found = findParentNodeInTree(n.children, id);
          if (found) return found;
        }
      }
      return null;
    }

    function removeNodeFromTree(nodes, id) {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) {
          nodes.splice(i, 1);
          return true;
        }
        if (nodes[i].children) {
          const removed = removeNodeFromTree(nodes[i].children, id);
          if (removed) return true;
        }
      }
      return false;
    }

    function openGodModal(event, idx) {
      if (event && event.stopPropagation) event.stopPropagation();
      editingGodIndex = idx;
      const fileInput = document.getElementById('modalGodImgFile');
      if (fileInput) fileInput.value = '';
      if (idx !== null && idx !== undefined) {
        const god = godsDatabase[idx];
        document.getElementById('godModalTitle').innerText = 'EDITAR DEUS';
        document.getElementById('modalGodName').value = god.name || '';
        document.getElementById('modalGodTitle').value = god.title || '';
        document.getElementById('btnDeleteGod').style.display = 'inline-flex';
      } else {
        document.getElementById('godModalTitle').innerText = 'NOVO DEUS';
        document.getElementById('modalGodName').value = '';
        document.getElementById('modalGodTitle').value = '';
        document.getElementById('btnDeleteGod').style.display = 'none';
      }
      document.getElementById('godModal').style.display = 'flex';
    }


    async function saveGodModal() {
  let createdGodIndex = null;
      const name = document.getElementById('modalGodName').value || 'NOVO DEUS';
      const title = document.getElementById('modalGodTitle').value || 'TÍTULO';
      const fileInput = document.getElementById('modalGodImgFile');
      const file = fileInput && fileInput.files[0];

      try {
        if (editingGodIndex !== null && editingGodIndex !== undefined) {
          const god = godsDatabase[editingGodIndex];
          god.name = name;
          god.title = title;
          if (file) god.img = await storeBlob(file);
          if (!Array.isArray(god.skins)) god.skins = [];
          ensureDefaultSkinsAndVoiceData(god);
        } else {
          const godImage = file
            ? await storeBlob(file)
            : defaultGodsDatabase[0].img;
          const godId = 'god_' + Date.now();

          const defaultSkin = {
            id: 'skin_default_' + godId,
            name: 'Padrão',
            tier: 'PADRÃO',
            img: godImage,
            dubber: '',
            releaseDate: '',
            voiceTree: [],
            announcerTree: [],
            vgsDatabase: []
          };

          const newGod = {
            id: godId,
            name: name,
            title: title,
            pantheon: 'Japonês',
            type: 'Físico',
            class: 'Caçador',
            classImg: '/smite-icons/NewUI_Class_Hunter.webp',
            miniQuote: 'Frase curta...',
            difficulty: 'Média',
            lore: 'História do novo deus...',
            dubber: '',
            releaseDate: '',
            img: godImage,
            skins: [defaultSkin],
            voiceTree: [],
            announcerTree: []
          };
          godsDatabase.push(newGod);
        createdGodIndex = godsDatabase.length - 1;
        selectedGodIdx = createdGodIndex;
        selectedSkinIdx = 0;
        }

        await saveStorageData();
        renderRoster();
        closeModal('godModal');
      if (createdGodIndex !== null) {
        selectGod(createdGodIndex);
      }
      } catch (err) {
        console.error('Erro ao salvar deus:', err);
        alert('Não foi possível salvar o deus com essa imagem.');
      }
    }

        async function deleteCurrentGod() {
      if (editingGodIndex !== null && editingGodIndex !== undefined) {
        godsDatabase.splice(editingGodIndex, 1);
        await saveStorageData();
        renderRoster();
        closeModal('godModal');
      }
    }



    function openAboutModal() {
      const god = godsDatabase[selectedGodIdx];
      if (!god) return;

      [
        ['aboutPantheonBank', god.pantheonImg],
        ['aboutTypeBank', god.typeImg],
        ['aboutClassBank', god.classImg]
      ].forEach(([id, current]) => {
        const select = document.getElementById(id);
        if (!select) return;
        select.value = [...select.options].some(option => option.value === current)
          ? current
          : '';
      });

      document.getElementById('aboutQuote').value = god.miniQuote || '';

      const difficulty = document.getElementById('aboutDifficulty');
      if (difficulty) {
        const current = god.difficulty || 'Não definida';
        if (![...difficulty.options].some(option => option.value === current)) {
          const legacy = document.createElement('option');
          legacy.value = current;
          legacy.textContent = current;
          difficulty.appendChild(legacy);
        }
        difficulty.value = current;
      }

      document.getElementById('aboutModal').style.display = 'flex';
    }



    async function saveAboutModal() {
      const god = godsDatabase[selectedGodIdx];
      if (!god) return;

      god.miniQuote = document.getElementById('aboutQuote').value;
      god.difficulty =
        document.getElementById('aboutDifficulty')?.value || 'Não definida';

      const iconFields = [
        ['aboutPantheonBank', 'pantheonImg'],
        ['aboutTypeBank', 'typeImg'],
        ['aboutClassBank', 'classImg']
      ];

      iconFields.forEach(([id, field]) => {
        const selected = document.getElementById(id)?.value || '';
        if (selected) god[field] = selected;
      });

      const classNamesByImage = {
        '/smite-icons/NewUI_Class_Guardian.png': 'Guardião',
        '/smite-icons/NewUI_Class_Mage.png': 'Mago',
        '/smite-icons/NewUI_Class_Warrior.png': 'Guerreiro',
        '/smite-icons/NewUI_Class_Assassin.webp': 'Assassino',
        '/smite-icons/NewUI_Class_Unknown.png': 'Desconhecida',
        '/smite-icons/NewUI_Class_Hunter.webp': 'Caçador'
      };
      if (classNamesByImage[god.classImg]) {
        god.class = classNamesByImage[god.classImg];
      }

      try {
        await saveStorageData();
        renderGodView();
        closeModal('aboutModal');
      } catch (err) {
        console.error('Erro ao salvar informações do deus:', err);
        alert('Não foi possível salvar as informações.');
      }
    }


    function openLoreModal() {
      document.getElementById('loreTextarea').value = godsDatabase[selectedGodIdx].lore || '';
      document.getElementById('loreModal').style.display = 'flex';
    }

    async function saveLoreModal() {
      godsDatabase[selectedGodIdx].lore = document.getElementById('loreTextarea').value;
      await saveStorageData();
      renderGodView();
      closeModal('loreModal');
    }

    function openSkinModal(event, idx) {
      if (event && event.stopPropagation) event.stopPropagation();
      editingSkinIndex = (idx === undefined ? null : idx);
      const fileInput = document.getElementById('modalSkinImgFile');
      if (fileInput) fileInput.value = '';
      if (idx !== null && idx !== undefined) {
        const skin = godsDatabase[selectedGodIdx].skins[idx];
        document.getElementById('modalSkinName').value = skin.name || '';
        document.getElementById('modalSkinTier').value = (skin.tier || 'PADRÃO').toUpperCase();
        document.getElementById('btnDeleteSkinCard').style.display = 'inline-flex';
      } else {
        document.getElementById('modalSkinName').value = 'Nova Skin';
        document.getElementById('modalSkinTier').value = 'EXCLUSIVO';
        document.getElementById('btnDeleteSkinCard').style.display = 'none';
      }
      document.getElementById('editSkinModal').style.display = 'flex';
    }

    let savingSkin = false;
    async function saveSkinModal() {
      if (savingSkin) return;
      savingSkin = true;
      const god = godsDatabase[selectedGodIdx];
      if (!god.skins) god.skins = [];
      const name = document.getElementById('modalSkinName').value || 'Nova Skin';
      const tier = document.getElementById('modalSkinTier').value;
      const fileInput = document.getElementById('modalSkinImgFile');
      const file = fileInput && fileInput.files[0];
      try {
        let imgRef = null;
        if (file) imgRef = await storeBlob(file);
        if (editingSkinIndex !== null && editingSkinIndex !== undefined) {
          const skin = god.skins[editingSkinIndex];
          skin.name = name;
          skin.tier = tier;
          if (imgRef) skin.img = imgRef;
        } else {
          god.skins.push({
            id: 'skin_' + Date.now(),
            name: name,
            tier: tier,
            img: imgRef || god.img,
            dubber: god.dubber || '',
            releaseDate: god.releaseDate || '',
            voiceTree: [],
            announcerTree: [],
            vgsDatabase: []
          });
        }
        await saveStorageData();
        renderSkinsTab();
        if (document.getElementById('vpSkinCardsGrid')) renderVpSkinCardsPanel();
        if (currentGodTab === 'skins') {
          const shown = god.skins[selectedSkinIdx] || god;
          setStageBg(shown.img || god.img);
        }
        closeModal('editSkinModal');
      } catch (err) {
        alert('Não foi possível salvar a aparência com essa imagem. Tente de novo.');
      } finally {
        savingSkin = false;
      }
    }

    async function deleteCurrentSkinCard() {
      if (editingSkinIndex !== null && editingSkinIndex !== undefined) {
        godsDatabase[selectedGodIdx].skins.splice(editingSkinIndex, 1);
        if (selectedSkinIdx >= godsDatabase[selectedGodIdx].skins.length) selectedSkinIdx = 0;
        await saveStorageData();
        renderSkinsTab();
        if (document.getElementById('vpSkinCardsGrid')) renderVpSkinCardsPanel();
        closeModal('editSkinModal');
      }
    }

    function openSettingsModal() {
      applyVolumeUi();
      document.getElementById('settingsModal').style.display = 'flex';
    }

    function closeModal(id) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }

    function toggleEditModeSimple() {
      isEditMode = !isEditMode;
      const btn = document.getElementById('editToggleBtn');
      const app = document.getElementById('smite-app');
      if (isEditMode) {
        app.classList.remove('edit-mode-off');
        btn.innerText = 'ON';
      } else {
        app.classList.add('edit-mode-off');
        btn.innerText = 'OFF';
      }
      if (currentVPMode === 'vgs' && document.getElementById('screenVoicebankView').style.display !== 'none') {
        renderVgsWikiTables();
      }
    }

    function updateAudioVolume(val) {
      audioVolume = Number(val) / 100;
      const label = document.getElementById('volumeValText');
      if (label) label.innerText = val + '%';
      if (activeAudioInstance) {
        const gain = Number.isFinite(activeAudioInstance.__smiteGain)
          ? activeAudioInstance.__smiteGain : 1;
        activeAudioInstance.volume = audioVolume * gain;
      }
      try { localStorage.setItem('smite_audio_volume', String(audioVolume)); } catch (e) {}
    }

    function stopChatClock() {
      if (chatClockTimer) {
        clearInterval(chatClockTimer);
        chatClockTimer = null;
      }
    }

    function chatEl() {
      return document.getElementById('statusAudio');
    }

    function showWelcomeChat() {
      const el = chatEl();
      if (!el) return;
      stopChatClock();
      const token = ++chatToken;
      el.classList.remove('is-fading', 'is-playing');
      el.textContent = '[' + clockStamp() + ']: Bem vindo ao Smite!';
      setTimeout(() => {
        if (token !== chatToken) return;
        el.classList.add('is-fading');
        setTimeout(() => {
          if (token !== chatToken) return;
          el.classList.remove('is-fading');
          el.textContent = '[' + clockStamp() + ']: Olá! Digite um comando ou selecione um áudio para começar.';
          setTimeout(() => {
            if (token !== chatToken) return;
            el.classList.add('is-fading');
            setTimeout(() => {
              if (token !== chatToken) return;
              el.classList.remove('is-fading', 'is-playing');
              el.textContent = CHAT_IDLE;
            }, 560);
          }, 3400);
        }, 560);
      }, 2200);
    }

    const playbackNotices = [];
    let playbackNoticeId = 0;

    function renderPlaybackNotices() {
      const el = chatEl();
      const stack = document.getElementById('playbackNoticeStack');
      if (!el || !stack) return;

      if (typeof playbackNoticeResizeObserver !== 'undefined' && playbackNoticeResizeObserver) {
        try { playbackNoticeResizeObserver.disconnect(); } catch (_) {}
      }

      const current = playbackNotices.length
        ? playbackNotices[playbackNotices.length - 1]
        : null;
      const previous = current
        ? playbackNotices.slice(0, -1).slice(-2)
        : [];

      stack.replaceChildren();
      stack.classList.toggle('has-notices', previous.length > 0);

      previous.forEach((notice, index) => {
        const row = document.createElement('div');
        row.className = 'playback-notice-row';
        row.dataset.noticeId = String(notice.id);
        if (index === 0) row.classList.add('is-oldest');
        row.textContent = notice.text;
        stack.appendChild(row);
      });

      el.classList.toggle('is-playing', !!current);
      el.classList.toggle('has-playback-notices', previous.length > 0);
      el.replaceChildren();

      if (!current) {
        el.textContent = CHAT_IDLE;
        stack.style.display = 'none';
        return;
      }

      const text = document.createElement('span');
      text.className = 'playback-current-text';
      text.dataset.noticeId = String(current.id);

      const inner = document.createElement('span');
      inner.className = 'playback-current-text-inner';
      inner.textContent = current.text;
      text.appendChild(inner);
      el.appendChild(text);

      const positionNoticeStack = () => {
        const parent = stack.parentElement;
        if (!parent || !previous.length) {
          stack.style.display = 'none';
          return;
        }

        stack.style.display = 'flex';
        stack.style.top = '0px';
        stack.style.bottom = 'auto';
        stack.style.left = '0px';
        stack.style.right = 'auto';
        stack.style.width = 'auto';

        const anchor = el.querySelector('.playback-current-text');
        if (!anchor) {
          stack.style.display = 'none';
          return;
        }

        const parentRect = parent.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();

        const left = anchorRect.left - parentRect.left
          + parent.scrollLeft - (parent.clientLeft || 0);
        const width = Math.max(0, anchorRect.width);

        stack.style.setProperty('left', `${left}px`, 'important');
        stack.style.setProperty('right', 'auto', 'important');
        stack.style.width = `${width}px`;

        const stackHeight = stack.getBoundingClientRect().height;
        const top = anchorRect.top - parentRect.top
          + parent.scrollTop - (parent.clientTop || 0) - stackHeight;

        stack.style.top = `${top}px`;
      };

      const updateOverflow = () => {
        const availableWidth = text.clientWidth;
        const contentWidth = Math.max(
          inner.scrollWidth,
          inner.getBoundingClientRect().width
        );
        const distance = Math.max(0, contentWidth - availableWidth);
        const overflowing = availableWidth > 0 && distance > 2;

        text.classList.toggle('is-overflowing', overflowing);

        if (overflowing) {
          inner.style.setProperty('--smite-marquee-distance', `${distance}px`);
          inner.style.setProperty(
            '--marquee-duration',
            `${Math.max(8, Math.min(24, distance / 12))}s`
          );
        } else {
          inner.style.removeProperty('--smite-marquee-distance');
          inner.style.removeProperty('--marquee-duration');
          inner.style.removeProperty('transform');
        }

        positionNoticeStack();
      };

      updateOverflow();

      if (typeof ResizeObserver !== 'undefined') {
        playbackNoticeResizeObserver = new ResizeObserver(updateOverflow);
        playbackNoticeResizeObserver.observe(el);
        playbackNoticeResizeObserver.observe(text);
        playbackNoticeResizeObserver.observe(inner);
        playbackNoticeResizeObserver.observe(stack);
      }

      if (!window.__smiteNoticeStackResizeBound) {
        window.__smiteNoticeStackResizeBound = true;
        window.addEventListener('resize', () => {
          const audio = document.getElementById('statusAudio');
          const history = document.getElementById('playbackNoticeStack');
          if (!audio || !history || !history.classList.contains('has-notices')) return;
          const parent = history.parentElement;
          if (!parent) return;

          const pr = parent.getBoundingClientRect();
          const ar = audio.getBoundingClientRect();
          const st = getComputedStyle(audio);
          const bl = parseFloat(st.borderLeftWidth) || 0;
          const br = parseFloat(st.borderRightWidth) || 0;
          const pl = parseFloat(st.paddingLeft) || 0;
          const padR = parseFloat(st.paddingRight) || 0;

          history.style.left = `${ar.left - pr.left + parent.scrollLeft + bl + pl}px`;
          history.style.width = `${Math.max(0, ar.width - bl - br - pl - padR)}px`;
          history.style.right = 'auto';
          history.style.bottom = 'auto';
          history.style.top = `${ar.top - pr.top + parent.scrollTop - history.getBoundingClientRect().height}px`;
        });
      }
    }

    function startPlayingChat(speech, audio) {
      const el = chatEl();
      if (!el) return null;

      const notice = {
        id: ++playbackNoticeId,
        text: '[' + clockStamp() + ']: Reproduzindo: ' + String(speech || ''),
        timer: null
      };

      playbackNotices.push(notice);
      if (audio) audio.__smiteNoticeId = notice.id;

      while (playbackNotices.length > 3) {
        const oldest = playbackNotices.shift();
        if (oldest && oldest.timer) clearTimeout(oldest.timer);
      }

      renderPlaybackNotices();
      return notice.id;
    }

    function fadeOutPlayingChat(audio) {
      const noticeId = audio && audio.__smiteNoticeId;
      if (!noticeId) return;

      const notice = playbackNotices.find((item) => item.id === noticeId);
      if (!notice || notice.timer) return;

      notice.timer = setTimeout(() => {
        const id = String(noticeId);
        const stack = document.getElementById('playbackNoticeStack');
        const el = chatEl();

        /* Procura o elemento realmente visível: histórico ou texto atual. */
        const row = stack
          ? Array.from(stack.querySelectorAll('.playback-notice-row'))
              .find((item) => item.dataset.noticeId === id)
          : null;

        const currentText = el
          ? el.querySelector('.playback-current-text')
          : null;

        const target = row || (
          currentText && currentText.dataset.noticeId === id
            ? currentText
            : null
        );

        const removeNotice = () => {
          const index = playbackNotices.findIndex(
            (item) => item.id === noticeId
          );

          if (index !== -1) {
            playbackNotices.splice(index, 1);
            renderPlaybackNotices();
          }

          if (audio && audio.__smiteNoticeId === noticeId) {
            audio.__smiteNoticeId = null;
          }
        };

        if (!target || !target.isConnected) {
          removeNotice();
          return;
        }

        target.classList.remove('is-notice-entering');

        let finished = false;
        let fallback = null;
        let animation = null;

        const finish = () => {
          if (finished) return;
          finished = true;
          if (fallback !== null) clearTimeout(fallback);
          if (animation) {
            animation.onfinish = null;
            animation.oncancel = null;
          }
          removeNotice();
        };

        try {
          if (typeof target.animate === 'function') {
            animation = target.animate(
              [
                { opacity: 1, transform: 'translateY(0px)' },
                { opacity: 0, transform: 'translateY(-5px)' }
              ],
              {
                duration: 520,
                easing: 'ease-in',
                fill: 'forwards'
              }
            );

            animation.onfinish = finish;
            animation.oncancel = finish;
          } else {
            target.classList.add('is-notice-leaving');
          }
        } catch (error) {
          target.classList.add('is-notice-leaving');
        }

        fallback = setTimeout(finish, 750);
      }, 4500);
    }

    function resetPlayButton(btn) {
      if (!btn) return;
      btn.classList.remove('playing');
      btn.textContent = '▶️';
    }

    function fadeAudioGain(audio, targetGain, duration = 32, onComplete) {
      if (!audio) {
        if (onComplete) onComplete();
        return;
      }

      const token = (audio.__smiteFadeToken || 0) + 1;
      audio.__smiteFadeToken = token;
      const startGain = Number.isFinite(audio.__smiteGain)
        ? audio.__smiteGain : 1;
      const startTime = performance.now();

      const step = (now) => {
        if (audio.__smiteFadeToken !== token) return;

        const progress = duration <= 0
          ? 1 : Math.min(1, (now - startTime) / duration);
        const gain = startGain + (targetGain - startGain) * progress;

        audio.__smiteGain = gain;
        audio.volume = Math.max(0, Math.min(1, audioVolume * gain));

        if (progress < 1) {
          audio.__smiteFadeFrame = requestAnimationFrame(step);
        } else {
          audio.__smiteFadeFrame = 0;
          if (onComplete) onComplete();
        }
      };

      if (audio.__smiteFadeFrame) {
        cancelAnimationFrame(audio.__smiteFadeFrame);
      }
      audio.__smiteFadeFrame = requestAnimationFrame(step);
    }

    async function togglePlayAudio(ref, titleText, btnElement) {
      if (!ref || !btnElement) return;

      const requestId = ++audioSwitchToken;
      const current = activeAudioInstance;
      const currentButton = activePlayButtonElement;

      let url = mediaSync(ref);

      // Referências do IndexedDB podem ainda não ter uma URL em cache.
      if (!url) {
        try {
          url = await ensureMedia(ref);
        } catch (error) {
          console.error('[SMITE VB] Falha ao carregar áudio:', ref, error);
          return;
        }
      }

      // Uma solicitação mais recente tem prioridade.
      if (requestId !== audioSwitchToken) return;

      if (!url) {
        console.error('[SMITE VB] Áudio sem URL disponível:', ref);
        return;
      }

      const startRequestedAudio = () => {
        if (requestId !== audioSwitchToken) return;

        const audio = new Audio(url);
        audio.__smiteGain = 0;
        audio.volume = 0;

        activeAudioInstance = audio;
        activePlayButtonElement = btnElement;
        activeAudioLabel = titleText;

        btnElement.classList.add('playing');
        btnElement.textContent = '⏸️';

        audio.onerror = () => {
          console.error(
            '[SMITE VB] Erro ao decodificar/carregar áudio:',
            ref,
            audio.error
          );
        };

        audio.onended = () => {
          resetPlayButton(btnElement);
          if (activeAudioInstance === audio) {
            activeAudioInstance = null;
            activePlayButtonElement = null;
          }
          fadeOutPlayingChat(audio);
        };

        audio.play().then(() => {
          if (
            activeAudioInstance === audio &&
            requestId === audioSwitchToken
          ) {
            audio.__smiteNoticeId = startPlayingChat(titleText, audio);
            fadeAudioGain(audio, 1, 32);
          }
        }).catch((error) => {
          console.error('[SMITE VB] Reprodução recusada:', ref, error);

          if (activeAudioInstance === audio) {
            activeAudioInstance = null;
            activePlayButtonElement = null;
          }

          audio.onended = null;
          audio.pause();
          audio.volume = 0;
          audio.__smiteGain = 0;
          resetPlayButton(btnElement);
          fadeOutPlayingChat(audio);
        });
      };

      // Mesmo botão: pausar ou retomar.
      if (current && currentButton === btnElement) {
        if (!current.paused) {
          fadeAudioGain(current, 0, 32, () => {
            if (requestId !== audioSwitchToken) return;
            current.pause();
            current.volume = audioVolume;
            current.__smiteGain = 1;
            resetPlayButton(btnElement);
            fadeOutPlayingChat(current);
          });
          return;
        }

        current.__smiteGain = 0;
        current.volume = 0;

        current.play().then(() => {
          if (
            activeAudioInstance !== current ||
            requestId !== audioSwitchToken
          ) return;

          btnElement.classList.add('playing');
          btnElement.textContent = '⏸️';
          fadeAudioGain(current, 1, 32);
          current.__smiteNoticeId = startPlayingChat(titleText, current);
        }).catch((error) => {
          console.error('[SMITE VB] Falha ao retomar áudio:', ref, error);
          if (activeAudioInstance === current) {
            resetPlayButton(btnElement);
            fadeOutPlayingChat(current);
          }
        });
        return;
      }

      // Troca de faixa: encerra a anterior antes de iniciar a nova.
      if (current) {
        current.onended = null;
        let switchFinished = false;

        const finishSwitch = () => {
          if (switchFinished || requestId !== audioSwitchToken) return;
          switchFinished = true;

          if (current.__smiteFadeFrame) {
            cancelAnimationFrame(current.__smiteFadeFrame);
            current.__smiteFadeFrame = 0;
          }

          current.__smiteFadeToken = (current.__smiteFadeToken || 0) + 1;
          current.pause();
          try {
            current.currentTime = 0;
          } catch (error) {}

          current.volume = 0;
          current.__smiteGain = 0;
          resetPlayButton(currentButton);
          fadeOutPlayingChat(current);

          if (activeAudioInstance === current) {
            activeAudioInstance = null;
            activePlayButtonElement = null;
          }

          startRequestedAudio();
        };

        fadeAudioGain(current, 0, 32, finishSwitch);
        setTimeout(finishSwitch, 100);
        return;
      }

      startRequestedAudio();
    }

    function bindGlobalInteractions() {
      if (window.__smiteDelegated) return;
      window.__smiteDelegated = true;
      document.addEventListener('click', (e) => {
        const playBtn = e.target.closest && e.target.closest('.vgs-play-double-btn');
        if (playBtn && playBtn.dataset.audioRef) {
          e.preventDefault();
          e.stopPropagation();
          togglePlayAudio(playBtn.dataset.audioRef, playBtn.dataset.audioLabel || '', playBtn);
          return;
        }
        const link = e.target.closest && e.target.closest('.vgs-editable.is-link');
        if (link && link.dataset.linkBox && link.getAttribute('contenteditable') !== 'true') {
          e.preventDefault();
          jumpToVgsBox(link.dataset.linkBox);
        }
      });
      document.addEventListener('input', (e) => {
        const el = e.target && e.target.closest && e.target.closest('.vgs-editable');
        if (!el || !el.isContentEditable) return;
        commitVgsCell(el);
      });
      document.addEventListener('focusout', (e) => {
        const el = e.target && e.target.closest && e.target.closest('.vgs-editable');
        if (!el || el.getAttribute('contenteditable') !== 'true') return;
        if (el.contains(e.relatedTarget)) return;
        commitVgsCell(el);
        flushPendingVgsRender();
      });
      document.addEventListener('keydown', (e) => {
        const el = e.target && e.target.closest && e.target.closest('.vgs-editable');
        if (!el || !el.isContentEditable) return;
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        if (el.dataset.field === 'code') {
          e.preventDefault();
          el.blur();
          return;
        }
        if (el.dataset.field === 'result') {
          e.preventDefault();
          document.execCommand('insertLineBreak');
          commitVgsCell(el);
        }
      });
    }

    function initPencilDrag() {
      const btn = document.getElementById('globalPageEditBtn');
      if (!btn || btn.dataset.dragReady === '1') return;
      btn.dataset.dragReady = '1';

      let drag = null;
      const DRAG_THRESHOLD = 12;
      const EDGE_GAP = 8;

      function clamp(value, min, max) {
        return Math.max(min, Math.min(Math.max(min, max), value));
      }

      function placeButton(x, y, snapToEdge, persist = false) {
        const rect = btn.getBoundingClientRect();
        const width = rect.width || 46;
        const height = rect.height || 46;
        const maxX = window.innerWidth - width - EDGE_GAP;
        const maxY = window.innerHeight - height - EDGE_GAP;

        x = clamp(x, EDGE_GAP, maxX);
        y = clamp(y, EDGE_GAP, maxY);

        if (snapToEdge) {
          const centerX = x + width / 2;
          x = centerX < window.innerWidth / 2
            ? EDGE_GAP
            : Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
        }

        btn.style.left = x + 'px';
        btn.style.top = y + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';

        if (persist) {
          try {
            localStorage.setItem('smite_pencil_pos', JSON.stringify({
              x: x,
              y: y
            }));
          } catch (err) {}
        }
      }

      // Restaura a posição salva e encaixa o botão na lateral mais próxima.
      try {
        const saved = JSON.parse(localStorage.getItem('smite_pencil_pos') || 'null');
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
          placeButton(saved.x, saved.y, true, false);
        }
      } catch (err) {}

      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const rect = btn.getBoundingClientRect();
        drag = {
          dx: e.clientX - rect.left,
          dy: e.clientY - rect.top,
          sx: e.clientX,
          sy: e.clientY,
          moved: false,
          pid: e.pointerId
        };
      });

      btn.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.pid) return;

        if (!drag.moved) {
          if (
            Math.abs(e.clientX - drag.sx) < DRAG_THRESHOLD &&
            Math.abs(e.clientY - drag.sy) < DRAG_THRESHOLD
          ) return;

          drag.moved = true;
          btn.classList.add('is-dragging');
          try { btn.setPointerCapture(e.pointerId); } catch (err) {}
        }

        placeButton(e.clientX - drag.dx, e.clientY - drag.dy, false);
      });

      function endDrag(e) {
        if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.pid)) return;

        const moved = drag.moved;
        drag = null;
        btn.classList.remove('is-dragging');

        if (!moved) return;

        btn.dataset.suppressClick = '1';
        setTimeout(() => {
          btn.dataset.suppressClick = '';
        }, 350);
        const rect = btn.getBoundingClientRect();
        placeButton(rect.left, rect.top, true, true);
      }

      btn.addEventListener('pointerup', endDrag);
      btn.addEventListener('pointercancel', endDrag);

      btn.addEventListener('click', (e) => {
        if (btn.dataset.suppressClick !== '1') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        btn.dataset.suppressClick = '';
      }, true);

      window.addEventListener('resize', () => {
        const rect = btn.getBoundingClientRect();
        placeButton(rect.left, rect.top, true, true);
      });
    }

    async function bootSmiteWiki() {
      const app = document.getElementById('smite-app');
      if (!app || app.dataset.booted === '1') return;
      app.dataset.booted = '1';
      bindGlobalInteractions();
      initPencilDrag();
      try {
        await loadStorageData();
      } catch (e) {
        if (!godsDatabase.length) godsDatabase = JSON.parse(JSON.stringify(defaultGodsDatabase));
        applyMainBg();
      }
      showWelcomeChat();
    }

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', bootSmiteWiki);
    } else {
      bootSmiteWiki();
    }
    window.bootSmiteWiki = bootSmiteWiki;
