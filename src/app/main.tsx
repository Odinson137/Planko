import { preloadPhotoTextures } from '../core/textures/PhotoTextures';

const splash = document.getElementById('startup-screen')!;
const status = document.getElementById('startup-status')!;
const detail = document.getElementById('startup-detail')!;
const percent = document.getElementById('startup-percent')!;
const progressBar = document.getElementById('startup-progress')!;
const progressFill = document.getElementById('startup-progress-fill')!;
const retry = document.getElementById('startup-retry') as HTMLButtonElement;
retry.addEventListener('click', () => window.location.reload());

function updateProgress(value: number): void {
  percent.textContent = `${value}%`;
  progressFill.style.width = `${value}%`;
  progressBar.setAttribute('aria-valuenow', String(value));
}

async function start(): Promise<void> {
  performance.mark('planko-start');
  try {
    let appLoaded = false;
    let completed = 0;
    let total = 0;
    const report = () => updateProgress(Math.round((completed + Number(appLoaded)) / (total + 2) * 100));
    const [app] = await Promise.all([
      import('./mountApp').then(module => {
        appLoaded = true;
        report();
        return module;
      }),
      preloadPhotoTextures(progress => {
        completed = progress.completed;
        total = progress.total;
        status.textContent = completed < total ? 'Загружаем материалы…' : 'Открываем приложение…';
        detail.textContent = completed < total ? `Текстуры: ${completed} из ${total}` : 'Подготовка интерфейса';
        report();
      }),
    ]);
    let ready = false;
    app.mountApp(document.getElementById('root')!, () => {
      // StrictMode runs effects twice in development.
      if (ready) return;
      ready = true;
      updateProgress(100);
      status.textContent = 'Всё готово';
      detail.textContent = 'Рабочее пространство готово';
      performance.mark('planko-ready');
      performance.measure('planko-startup', 'planko-start', 'planko-ready');
      splash.classList.add('is-ready');
      splash.addEventListener('transitionend', () => splash.remove(), { once: true });
      // Also clean up with reduced motion or if no transition event is emitted.
      setTimeout(() => splash.remove(), 250);
    });
  } catch (error) {
    console.error('Не удалось запустить Planko', error);
    splash.classList.add('has-error');
    status.textContent = 'Не удалось запустить приложение';
    detail.textContent = 'Попробуйте загрузить приложение ещё раз';
    retry.hidden = false;
  }
}

void start();
