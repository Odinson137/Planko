-- Базовая схема базы данных SQLite для проекта Planko

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('SHEET', 'SLAT')) NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    thickness REAL NOT NULL,
    color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS walls (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    material_id TEXT NOT NULL,
    joint_profile_type TEXT DEFAULT 'H_JOINT',
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(material_id) REFERENCES materials(id)
);

CREATE TABLE IF NOT EXISTS openings (
    id TEXT PRIMARY KEY,
    wall_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('DOOR', 'WINDOW', 'TV_ZONE', 'NICHE')) NOT NULL,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    slope_depth REAL DEFAULT 0,
    FOREIGN KEY(wall_id) REFERENCES walls(id) ON DELETE CASCADE
);

-- Начальные данные: 3 базовых материала
INSERT OR IGNORE INTO materials (id, name, type, width, height, thickness, color) VALUES
('mat-sheet-1220', 'Листовая панель (1220 × 2800 × 5 мм)', 'SHEET', 1220, 2800, 5, '#d6cbbe'),
('mat-slat-16', 'Реечная панель (145 × 3000 × 16 мм)', 'SLAT', 145, 3000, 16, '#b89772'),
('mat-slat-15', 'Реечная панель (145 × 3000 × 15 мм)', 'SLAT', 145, 3000, 15, '#967451');
