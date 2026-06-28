# Control de deudas Alan/Mairon

App local para administrar deudas, cuotas y proyecciones mensuales de Alan y Mairon.

## Ejecutar

1. Instalar dependencias del frontend:

   ```powershell
   cd frontend
   pnpm install
   pnpm build
   ```

2. Levantar la app:

   ```powershell
   cd ..
   .\run.ps1
   ```

3. Abrir:

   ```text
   http://127.0.0.1:8008
   ```

La base SQLite queda en `backend/data/debts.sqlite`. Si se elimina ese archivo, el backend vuelve a cargar los datos iniciales desde `backend/seed_debts.json`.

## Modelo

- El mes de término se calcula por `mes inicio + cuotas - 1`.
- Alan y Mairon tienen montos mensuales independientes.
- Las deudas con terceros o montos especiales usan modo `personalizado`.
- `Arcangel` queda corregido a septiembre por conteo de cuotas.
- `Perfumes Alan` y `Perfumes Mairon` quedan como deudas separadas.
