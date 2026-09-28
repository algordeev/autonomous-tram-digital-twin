# Локальный запуск standalone-версии

Проект не требует ChatGPT Sites, Next.js, Cloudflare, базы данных или отдельного
серверного приложения.

## Запуск для разработки

Установите Node.js версии 22.13 или новее, затем выполните:

```bash
npm install
npm run dev
```

Откройте `http://localhost:5173`.

## Статическая сборка

```bash
npm run build
npm run preview
```

Готовые файлы находятся в `dist/`. Эту папку можно целиком загрузить на обычный
статический хостинг. Для корректной работы WebAssembly сервер должен отдавать
`.wasm` как `application/wasm`; GitHub Pages, Cloudflare Pages, Netlify и Vercel
делают это автоматически.

## Установка как приложение

После первой загрузки production-версии откройте меню браузера и выберите
«Установить приложение». Service Worker сохраняет интерфейс, сценарии и
C++/WebAssembly-ядро для последующего офлайн-запуска.

## Проверки

```bash
npm run build
npm test
npm run test:cpp
```

Длительные полносетевые проверки запускаются отдельно:

```bash
npm run test:simulation
npm run test:izmir
```
