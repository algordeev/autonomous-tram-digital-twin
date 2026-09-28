# Публикация на GitHub

## Перед первой загрузкой

1. Выберите лицензию или сознательно оставьте `UNLICENSED`.
2. Проверьте имя автора в `CITATION.cff`.
3. Выполните `npm run test:all`.
4. Убедитесь, что `git diff --cached --check` ничего не выводит.

## Первый коммит

```bash
git commit -m "Initial public release"
```

На GitHub создайте пустой репозиторий `autonomous-tram-digital-twin`, не добавляя
автоматические README, LICENSE и `.gitignore`. Затем выполните:

```bash
git remote add origin https://github.com/YOUR-USER/autonomous-tram-digital-twin.git
git push -u origin main
```

## GitHub Pages

В настройках репозитория откройте **Pages** и выберите источник **GitHub
Actions**. Workflow `.github/workflows/pages.yml` сам соберёт и опубликует
статический каталог `dist/` после push в `main`.

## После публикации

- дождитесь успешного прохождения workflow `Build and test`;
- добавьте ссылку GitHub Pages в описание репозитория;
- добавьте темы `tram`, `digital-twin`, `webassembly`, `transport-simulation`,
  `regenerative-braking`, `flywheel-energy-storage`;
- после проверки создайте тег и релиз `v1.0.0`;
- включите защиту ветки `main` и обязательное прохождение CI для будущих PR.
