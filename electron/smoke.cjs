'use strict';

// Runs only when the desktop main process explicitly receives --smoke-test.
// The production permission handlers remain active. Fake input is enabled by
// main only for this isolated test profile; no physical microphone is used.
const fs = require('node:fs/promises');
const path = require('node:path');

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds} ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runSmoke(window, { outputPath }) {
  if (!path.isAbsolute(outputPath)) throw new Error('Smoke output path must be absolute.');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const screenshotPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, '.json')}.png`);
  const exportPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, '.json')}-tunings.json`);
  const contents = window.webContents;
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    executable: process.execPath,
    versions: process.versions,
    url: contents.getURL(),
    microphone: 'Synthetic Chromium test device; physical input quality is not tested.',
    checks: [],
    errors: [],
    screenshotPath,
  };
  async function check(name, action) {
    const started = Date.now();
    try {
      const details = await withTimeout(Promise.resolve().then(action), 10000, name);
      report.checks.push({ name, ok: true, durationMs: Date.now() - started, details });
      return details;
    } catch (error) {
      report.checks.push({ name, ok: false, durationMs: Date.now() - started, error: error.message });
      throw error;
    }
  }
  function renderer(fn, ...args) {
    const script = `(async () => {
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const saved = () => JSON.parse(localStorage.getItem('stringroom-v1') || '{}');
      const waitFor = async (predicate, message, milliseconds = 6000) => {
        const deadline = Date.now() + milliseconds;
        while (Date.now() < deadline) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 35));
        }
        throw new Error(message + ' / ' + (document.getElementById('error-box')?.textContent || ''));
      };
      return (${fn.toString()})(...${JSON.stringify(args)});
    })()`;
    return contents.executeJavaScript(script, true);
  }

  try {
    await check('Renderer readiness and secure local origin', () => renderer(async () => {
      await waitFor(() => document.querySelectorAll('.preset-item').length >= 5, 'Tuning library did not render.');
      assert(window.isSecureContext, 'Custom app protocol is not a secure context.');
      assert(!!navigator.mediaDevices?.getUserMedia, 'getUserMedia is unavailable.');
      assert(typeof window.require === 'undefined' && typeof window.process === 'undefined', 'Renderer exposes Node globals.');
      assert(getComputedStyle(document.querySelector('.workspace')).display === 'grid', 'Stylesheet did not load.');
      assert(document.querySelectorAll('#strings .string').length === 6, 'Standard guitar strings did not render.');
      return { secureContext: isSecureContext, protocol: location.protocol, presetCount: document.querySelectorAll('.preset-item').length, title: document.title };
    }));

    const custom = await check('Create and edit a custom tuning through the UI', () => renderer(async () => {
      document.getElementById('custom-open').click();
      document.getElementById('custom-name').value = 'Desktop smoke';
      document.getElementById('custom-notes').value = 'C2 G2 C3 G3 C4 E4';
      document.getElementById('custom-form').requestSubmit();
      await waitFor(() => saved().customs?.length === 1, 'Custom tuning was not saved.');
      const original = saved().customs[0];
      const row = [...document.querySelectorAll('.preset-item')].find(item => item.dataset.tuningId === original.id);
      assert(!!row, 'Created tuning is absent from the library.');
      row.querySelector('.edit-preset').click();
      assert(document.getElementById('custom-name').value === 'Desktop smoke', 'Edit dialog did not prefill the name.');
      assert(document.getElementById('custom-notes').value === 'C2 G2 C3 G3 C4 E4', 'Edit dialog did not prefill the notes.');
      document.getElementById('custom-name').value = 'Desktop smoke edited';
      document.getElementById('custom-notes').value = 'D2 A2 D3 G3 A3 D4';
      document.getElementById('custom-form').requestSubmit();
      const result = saved().customs;
      assert(result.length === 1 && result[0].id === original.id, 'Editing changed the tuning identity or created a duplicate.');
      assert(result[0].name === 'Desktop smoke edited' && result[0].notes.join(' ') === 'D2 A2 D3 G3 A3 D4', 'Edited tuning values were not saved.');
      return result[0];
    }));

    await check('Search and move a tuning to the first position', () => renderer((id) => {
      const search = document.getElementById('tuning-search');
      search.value = 'smoke edited';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const matches = [...document.querySelectorAll('.preset-item')];
      assert(matches.length === 1 && matches[0].dataset.tuningId === id, 'Search did not isolate the custom tuning.');
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const row = [...document.querySelectorAll('.preset-item')].find(item => item.dataset.tuningId === id);
      row.querySelector('[data-reorder-handle]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      assert(document.querySelector('.preset-item').dataset.tuningId === id, 'Tuning did not move to the top.');
      assert(saved().tuningOrder.guitar[0] === id, 'Tuning order was not persisted.');
      return { firstTuningId: id };
    }, custom.id));

    await check('Start and stop the microphone with synthetic input', () => renderer(async () => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const streams = [];
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints);
        streams.push(stream);
        return stream;
      };
      try {
        const button = document.getElementById('mic-toggle');
        button.click();
        await waitFor(() => button.querySelector('span').textContent === 'Stop', 'Microphone did not reach Listening.');
        assert(streams.length === 1 && streams[0].getAudioTracks().some(track => track.readyState === 'live'), 'No live audio track was acquired.');
        const label = streams[0].getAudioTracks()[0].label;
        button.click();
        await waitFor(() => streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), 'Audio tracks were not released.');
        assert(button.querySelector('span').textContent === 'Start microphone', 'Microphone UI did not return to the stopped state.');
        return { inputLabel: label, stoppedTracks: true };
      } finally {
        navigator.mediaDevices.getUserMedia = original;
        streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
      }
    }));

    await check('Camera permission is denied by the real permission policy', () => renderer(async () => {
      let acceptedStream;
      let rejection;
      try { acceptedStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
      catch (error) { rejection = { name: error.name, message: error.message }; }
      acceptedStream?.getTracks().forEach(track => track.stop());
      assert(!acceptedStream && rejection?.name === 'NotAllowedError', 'Camera access was not explicitly denied: ' + JSON.stringify(rejection));
      return rejection;
    }));

    let exported;
    await check('Export uses the native Electron download path', async () => {
      let onDownload;
      const completion = new Promise((resolve, reject) => {
        onDownload = (_event, item, source) => {
          if (source !== contents) return;
          item.setSavePath(exportPath);
          item.once('done', (_doneEvent, state) => {
            if (state === 'completed') resolve({ filename: item.getFilename(), path: item.getSavePath() });
            else reject(new Error(`Export download ended with ${state}.`));
          });
        };
        contents.session.on('will-download', onDownload);
      });
      try {
        await renderer(() => {
          document.getElementById('settings-open').click();
          document.getElementById('export-custom').click();
          document.getElementById('settings-dialog').close();
          return true;
        });
        const download = await withTimeout(completion, 7000, 'JSON export');
        exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
        if (exported.version !== 1 || exported.tunings?.length !== 1 || exported.tunings[0].name !== custom.name) throw new Error('Exported JSON does not contain the edited tuning.');
        return download;
      } finally {
        contents.session.removeListener('will-download', onDownload);
      }
    });

    await check('Import an exported tuning using the file input handler', () => renderer(async (backup) => {
      backup.tunings[0].name = 'Imported desktop smoke';
      const transfer = new DataTransfer();
      transfer.items.add(new File([JSON.stringify(backup)], 'smoke-tunings.json', { type: 'application/json' }));
      const input = document.getElementById('import-file');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => saved().customs?.length === 2, 'Imported tuning was not saved.');
      assert(saved().customs.some(tuning => tuning.name === 'Imported desktop smoke'), 'Imported name is missing.');
      return { customs: saved().customs.length, message: document.getElementById('settings-message').textContent };
    }, exported));

    await check('Custom tunings and ordering survive a renderer reload', async () => {
      await contents.loadURL(contents.getURL());
      return renderer(async (id) => {
        await waitFor(() => document.querySelectorAll('.preset-item').length >= 5, 'Library did not rerender after reload.');
        assert(saved().customs.length === 2, 'Custom tunings were lost after reload.');
        assert(saved().tuningOrder.guitar[0] === id && document.querySelector('.preset-item').dataset.tuningId === id, 'Tuning order was lost after reload.');
        assert(document.getElementById('current-tuning').textContent === 'Desktop smoke edited', 'Selected tuning was lost after reload.');
        return { customCount: saved().customs.length, firstTuningId: id };
      }, custom.id);
    });
  } catch (error) {
    report.errors.push({ message: error.message, stack: error.stack });
  }

  try {
    await check('Capture the packaged application window', async () => {
      await contents.executeJavaScript('document.fonts.ready.then(() => true)');
      // DOM assertions can finish before the hidden window's next compositor
      // frame, especially immediately after reload. Let it present that frame.
      await new Promise(resolve => setTimeout(resolve, 350));
      const image = await contents.capturePage(undefined, { stayHidden: true });
      if (image.isEmpty()) throw new Error('Captured image is empty.');
      await fs.writeFile(screenshotPath, image.toPNG());
      return { path: screenshotPath, size: image.getSize() };
    });
  } catch (error) {
    report.errors.push({ message: error.message, stack: error.stack });
  }
  report.ok = report.errors.length === 0 && report.checks.every(item => item.ok);
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { runSmoke };
