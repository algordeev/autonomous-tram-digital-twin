# C++ ядро: единая реализация для native и WASM

`cpp-core/src/operational_core.cpp` — общий исходный код C++17 для браузера
и нативных тестов. Старый модульный прототип ABI 1 и отдельный нативный
демонстрационный replay удалены. Браузерные и TypeScript headless-сценарии
используют прежнюю оркестрацию.

## Сборка

Из корня репозитория:

```bash
npm ci
npm run build:wasm
npm run verify:wasm
npm run test:cpp
```

Сборка использует закреплённый в npm lockfile пакет `browsercc`, включая Clang,
LLD и sysroot. Emscripten не нужен. После изменения C++ нужно закоммитить
`public/wasm/tram-core.wasm` и сгенерированный `src/simulation-core/cpp-abi.ts`.
`verify:wasm` пересобирает модуль в памяти и проверяет точное совпадение байтов,
не перезаписывая файлы. Проверка обязательна в CI и перед публикацией Pages.
`cpp-core/scripts/build-wasm.sh` вызывает ту же сборку.

## Нативные проверки

Нужны компилятор C++17, Node.js и Make:

```bash
make -C cpp-core test
```

Или CMake:

```bash
cmake -S cpp-core -B cpp-core/build-cmake -DCMAKE_BUILD_TYPE=Release
cmake --build cpp-core/build-cmake
ctest --test-dir cpp-core/build-cmake --output-on-failure
```

Нативный тест вызывает рабочее ядро напрямую. Те же сценарии из
`tests/wasm-core.test.mjs` записывают вызовы WASM и повторяют их через
сгенерированный нативный transport в отдельном процессе для каждого экземпляра.
Каждый результат сравнивается с допуском 1e-9. Это проверка поведения и
согласованности двух целей сборки, а не исчерпывающая проверка всех входов.

## ABI и параметры

Полный ABI 11 объявлен в `cpp-core/include/tram/core_c_api.h`. Из него получаются
экспорты WASM, нативный transport и версия ABI для TypeScript. Состояние остаётся
единственным на процесс / экземпляр WASM; handle — токен, а не отдельная
симуляция. Подсистемы сбрасываются через свои функции `*_begin`.

В `control_parameters.hpp` отдельно названы физический предел служебного
торможения 1.25 м/с² и консервативная огибающая подхода 0.72 м/с² для ограничения
рывка. Начальная стоянка 12 секунд — именованный default; пассажирские и
конечные стоянки продлеваются через `tram_core_station_sync`. Квадратный корень
использует builtin компилятора, без ограниченного числа итераций Ньютона.

Подробнее: [C++ core](../../cpp-core/README.md), [архитектура](../ARCHITECTURE.md).
