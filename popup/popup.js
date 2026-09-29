(() => {
  'use strict';

  const { SCHEMA, DEFAULTS, load, save } = globalThis.BiliAmbientSettings;

  const percent = (v) => `${v}%`;

  // Popup layout. Keys map to settings.js SCHEMA entries.
  const SECTIONS = [
    {
      title: '光效',
      controls: [
        { key: 'spread', label: '光晕范围', format: percent },
        { key: 'blur', label: '模糊程度', format: percent },
        { key: 'brightness', label: '亮度', format: percent },
        { key: 'saturation', label: '饱和度', format: percent },
        { key: 'contrast', label: '对比度', format: percent },
      ],
    },
    {
      title: '边缘渐隐',
      controls: [
        { key: 'fadeStart', label: '渐隐起点', format: percent },
        { key: 'fadeCurve', label: '渐隐曲线', format: (v) => (v / 100).toFixed(1) },
        { key: 'edge', label: '边缘步长', format: percent, hint: '越小边缘色彩过渡越细腻，但绘制次数更多' },
      ],
    },
    {
      title: '页面',
      controls: [
        { key: 'darkTheme', label: '强制深色主题' },
        { key: 'cardOpacity', label: '卡片背景不透明度', format: percent },
        { key: 'headerTransparent', label: '顶栏半透明磨砂' },
        { key: 'textShadow', label: '文字阴影（提升可读性）' },
        { key: 'backgroundColor', label: '页面底色' },
      ],
    },
    {
      title: '画质与性能',
      controls: [
        { key: 'barDetection', label: '自动识别视频黑边' },
        { key: 'debanding', label: '去色带噪点', format: percent },
        { key: 'resolution', label: '渲染分辨率', format: percent },
        { key: 'fps', label: '帧率上限', format: (v) => (v === 0 ? '跟随视频' : `${v} fps`) },
      ],
    },
  ];

  const PRESETS = [
    { label: '柔和', values: { spread: 25, blur: 30, fadeStart: 15, fadeCurve: 120, brightness: 100, saturation: 100 } },
    { label: '沉浸', values: { spread: 150, blur: 45, fadeStart: 45, fadeCurve: 160, brightness: 100, saturation: 110 } },
    { label: '满屏（默认）', values: { spread: 260, blur: 60, fadeStart: 60, fadeCurve: 200, brightness: 95, saturation: 120 } },
  ];

  let settings = { ...DEFAULTS };
  const inputs = new Map(); // key -> { input, output?, format? }

  // Coalesce rapid slider input into a few storage writes; the page updates on each write.
  let saveTimer = 0;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = 0;
      try {
        settings = await save(settings);
      } catch (err) {
        console.error('[BiliAmbient] Failed to save settings', err);
      }
    }, 60);
  }

  function setValue(key, value) {
    settings = { ...settings, [key]: value };
    scheduleSave();
  }

  function buildControl(def) {
    const schema = SCHEMA[def.key];
    const id = `opt-${def.key}`;
    const row = document.createElement('div');
    row.className = `row row-${schema.type}`;

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = def.label;

    const input = document.createElement('input');
    input.id = id;

    if (schema.type === 'bool') {
      input.type = 'checkbox';
      input.addEventListener('change', () => setValue(def.key, input.checked));
      row.append(label, input);
      inputs.set(def.key, { input });
    } else if (schema.type === 'color') {
      input.type = 'color';
      input.addEventListener('input', () => setValue(def.key, input.value));
      row.append(label, input);
      inputs.set(def.key, { input });
    } else {
      input.type = 'range';
      input.min = String(schema.min);
      input.max = String(schema.max);
      input.step = String(schema.step);
      const output = document.createElement('output');
      output.htmlFor = id;
      const head = document.createElement('div');
      head.className = 'row-head';
      head.append(label, output);
      input.addEventListener('input', () => {
        const value = Number(input.value);
        output.textContent = def.format ? def.format(value) : String(value);
        input.setAttribute('aria-valuetext', output.textContent);
        setValue(def.key, value);
      });
      row.append(head, input);
      inputs.set(def.key, { input, output, format: def.format });
    }

    if (def.hint) {
      const hint = document.createElement('p');
      hint.className = 'row-hint';
      hint.id = `${id}-hint`;
      hint.textContent = def.hint;
      input.setAttribute('aria-describedby', hint.id);
      row.append(hint);
    }
    return row;
  }

  function render() {
    const container = document.getElementById('controls');
    for (const section of SECTIONS) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = section.title;
      fieldset.append(legend, ...section.controls.map(buildControl));
      container.append(fieldset);
    }

    const presetRow = document.getElementById('presets');
    for (const preset of PRESETS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = preset.label;
      button.addEventListener('click', () => {
        settings = { ...settings, ...preset.values };
        syncInputs();
        scheduleSave();
      });
      presetRow.append(button);
    }

    const enabled = document.getElementById('enabled');
    enabled.addEventListener('change', () => {
      setValue('enabled', enabled.checked);
      document.body.classList.toggle('is-disabled', !enabled.checked);
    });
    inputs.set('enabled', { input: enabled });

    document.getElementById('reset').addEventListener('click', () => {
      settings = { ...DEFAULTS };
      syncInputs();
      scheduleSave();
    });
  }

  function syncInputs() {
    for (const [key, { input, output, format }] of inputs) {
      const value = settings[key];
      if (input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = String(value);
      }
      if (output) {
        output.textContent = format ? format(value) : String(value);
        input.setAttribute('aria-valuetext', output.textContent);
      }
    }
    document.body.classList.toggle('is-disabled', !settings.enabled);
  }

  render();
  load().then((loaded) => {
    settings = loaded;
    syncInputs();
  });
})();
