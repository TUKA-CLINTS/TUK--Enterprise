-- TUK@ Enterprises Management System - database schema
-- Compatible with MySQL 5.7+ (WAMP) and MariaDB 10.x
-- Every business table is sync-ready: CHAR(36) client-generated id,
-- epoch-millisecond timestamps and a soft-delete flag.

CREATE DATABASE IF NOT EXISTS tukent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tukent;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) NOT NULL,
  phone         VARCHAR(40)  NOT NULL DEFAULT '',
  password_hash VARCHAR(100) NOT NULL,
  department    VARCHAR(20)  NOT NULL DEFAULT 'head-office',
  role          VARCHAR(20)  NOT NULL DEFAULT 'staff',
  status        VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_at    BIGINT       NOT NULL DEFAULT 0,
  updated_at    BIGINT       NOT NULL DEFAULT 0,
  deleted       TINYINT(1)   NOT NULL DEFAULT 0,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_updated (updated_at),
  KEY idx_users_department (department)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS account_applications (
  id                CHAR(36)     NOT NULL PRIMARY KEY,
  name              VARCHAR(120) NOT NULL,
  email             VARCHAR(160) NOT NULL,
  phone             VARCHAR(40)  NOT NULL DEFAULT '',
  department        VARCHAR(20)  NOT NULL,
  requirements      TEXT         NOT NULL,
  status            VARCHAR(30)  NOT NULL DEFAULT 'submitted',
  manager_id        CHAR(36)     NOT NULL DEFAULT '',
  admin_id          CHAR(36)     NOT NULL DEFAULT '',
  rejection_reason  VARCHAR(500) NOT NULL DEFAULT '',
  user_id           CHAR(36)     NOT NULL DEFAULT '',
  created_at        BIGINT       NOT NULL DEFAULT 0,
  updated_at        BIGINT       NOT NULL DEFAULT 0,
  KEY idx_applications_status (status),
  KEY idx_applications_department (department),
  KEY idx_applications_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Shop department
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  name          VARCHAR(160)  NOT NULL,
  sku           VARCHAR(60)   NOT NULL DEFAULT '',
  price         DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost          DECIMAL(12,2) NOT NULL DEFAULT 0,
  quantity      INT           NOT NULL DEFAULT 0,
  reorder_level INT           NOT NULL DEFAULT 5,
  created_at    BIGINT        NOT NULL DEFAULT 0,
  updated_at    BIGINT        NOT NULL DEFAULT 0,
  deleted       TINYINT(1)    NOT NULL DEFAULT 0,
  KEY idx_products_updated (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  product_id    CHAR(36)     NOT NULL DEFAULT '',
  movement_type VARCHAR(10)  NOT NULL DEFAULT 'in',
  qty           INT          NOT NULL DEFAULT 0,
  note          VARCHAR(255) NOT NULL DEFAULT '',
  created_at    BIGINT       NOT NULL DEFAULT 0,
  updated_at    BIGINT       NOT NULL DEFAULT 0,
  deleted       TINYINT(1)   NOT NULL DEFAULT 0,
  KEY idx_movements_updated (updated_at),
  KEY idx_movements_product (product_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_orders (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  customer_name VARCHAR(120)  NOT NULL DEFAULT '',
  items         JSON          NULL,
  total         DECIMAL(12,2) NOT NULL DEFAULT 0,
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending',
  order_date    VARCHAR(10)   NOT NULL DEFAULT '',
  created_at    BIGINT        NOT NULL DEFAULT 0,
  updated_at    BIGINT        NOT NULL DEFAULT 0,
  deleted       TINYINT(1)    NOT NULL DEFAULT 0,
  KEY idx_orders_updated (updated_at),
  KEY idx_orders_date (order_date)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Transport department
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  plate_no     VARCHAR(40)  NOT NULL DEFAULT '',
  model        VARCHAR(120) NOT NULL DEFAULT '',
  vehicle_type VARCHAR(40)  NOT NULL DEFAULT '',
  capacity     VARCHAR(60)  NOT NULL DEFAULT '',
  status       VARCHAR(20)  NOT NULL DEFAULT 'available',
  created_at   BIGINT       NOT NULL DEFAULT 0,
  updated_at   BIGINT       NOT NULL DEFAULT 0,
  deleted      TINYINT(1)   NOT NULL DEFAULT 0,
  KEY idx_vehicles_updated (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS drivers (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  license_no VARCHAR(60)  NOT NULL DEFAULT '',
  phone      VARCHAR(40)  NOT NULL DEFAULT '',
  status     VARCHAR(20)  NOT NULL DEFAULT 'available',
  created_at BIGINT       NOT NULL DEFAULT 0,
  updated_at BIGINT       NOT NULL DEFAULT 0,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  KEY idx_drivers_updated (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trips (
  id          CHAR(36)     NOT NULL PRIMARY KEY,
  vehicle_id  CHAR(36)     NOT NULL DEFAULT '',
  driver_id   CHAR(36)     NOT NULL DEFAULT '',
  origin      VARCHAR(120) NOT NULL DEFAULT '',
  destination VARCHAR(120) NOT NULL DEFAULT '',
  customer_name VARCHAR(120) NOT NULL DEFAULT '',
  fare        DECIMAL(12,2) NOT NULL DEFAULT 0,
  departure   BIGINT       NOT NULL DEFAULT 0,
  arrival     BIGINT       NOT NULL DEFAULT 0,
  cargo       VARCHAR(255) NOT NULL DEFAULT '',
  status      VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  created_at  BIGINT       NOT NULL DEFAULT 0,
  updated_at  BIGINT       NOT NULL DEFAULT 0,
  deleted     TINYINT(1)   NOT NULL DEFAULT 0,
  KEY idx_trips_updated (updated_at),
  KEY idx_trips_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Restaurant department
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_items (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  name        VARCHAR(120)  NOT NULL,
  category    VARCHAR(40)   NOT NULL DEFAULT 'main',
  price       DECIMAL(12,2) NOT NULL DEFAULT 0,
  available   TINYINT(1)    NOT NULL DEFAULT 1,
  description VARCHAR(255)  NOT NULL DEFAULT '',
  created_at  BIGINT        NOT NULL DEFAULT 0,
  updated_at  BIGINT        NOT NULL DEFAULT 0,
  deleted     TINYINT(1)    NOT NULL DEFAULT 0,
  KEY idx_menu_updated (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS restaurant_orders (
  id         CHAR(36)      NOT NULL PRIMARY KEY,
  customer_name VARCHAR(120) NOT NULL DEFAULT '',
  table_no   VARCHAR(20)   NOT NULL DEFAULT '',
  items      JSON          NULL,
  total      DECIMAL(12,2) NOT NULL DEFAULT 0,
  status     VARCHAR(20)   NOT NULL DEFAULT 'pending',
  created_at BIGINT        NOT NULL DEFAULT 0,
  updated_at BIGINT        NOT NULL DEFAULT 0,
  deleted    TINYINT(1)    NOT NULL DEFAULT 0,
  KEY idx_rorders_updated (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservations (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  customer_name VARCHAR(120) NOT NULL DEFAULT '',
  phone         VARCHAR(40)  NOT NULL DEFAULT '',
  party_size    INT          NOT NULL DEFAULT 1,
  date          VARCHAR(10)  NOT NULL DEFAULT '',
  time          VARCHAR(8)   NOT NULL DEFAULT '',
  table_no      VARCHAR(20)  NOT NULL DEFAULT '',
  status        VARCHAR(20)  NOT NULL DEFAULT 'booked',
  created_at    BIGINT       NOT NULL DEFAULT 0,
  updated_at    BIGINT       NOT NULL DEFAULT 0,
  deleted       TINYINT(1)   NOT NULL DEFAULT 0,
  KEY idx_reservations_updated (updated_at),
  KEY idx_reservations_date (date)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Security & audit (server-side only; not part of the offline sync)
-- ---------------------------------------------------------------------------
-- Identity documents captured for the account-recovery flow.
CREATE TABLE IF NOT EXISTS recovery_documents (
  id         CHAR(36)      NOT NULL PRIMARY KEY,
  user_id    CHAR(36)      NOT NULL,
  doc_type   VARCHAR(30)   NOT NULL,             -- national_id | driving_license | permit
  doc_number VARCHAR(100)  NOT NULL DEFAULT '',
  image_data MEDIUMTEXT    NOT NULL,             -- base64 data URL of the captured document
  created_at BIGINT        NOT NULL DEFAULT 0,
  updated_at BIGINT        NOT NULL DEFAULT 0,
  deleted    TINYINT(1)    NOT NULL DEFAULT 0,
  KEY idx_recdocs_user (user_id)
) ENGINE=InnoDB;

-- Account-recovery attempts (email code + document verification).
CREATE TABLE IF NOT EXISTS recovery_requests (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  user_id              CHAR(36)     NOT NULL,
  email                VARCHAR(160) NOT NULL DEFAULT '',
  code_hash            VARCHAR(100) NOT NULL DEFAULT '',
  code_expires_at      BIGINT       NOT NULL DEFAULT 0,
  code_attempts        INT          NOT NULL DEFAULT 0,
  status               VARCHAR(30)  NOT NULL DEFAULT 'awaiting_code',
  submitted_doc_type   VARCHAR(30)  NOT NULL DEFAULT '',
  submitted_doc_number VARCHAR(100) NOT NULL DEFAULT '',
  submitted_image      MEDIUMTEXT   NULL,
  registered_doc_id    CHAR(36)     NOT NULL DEFAULT '',
  ip                   VARCHAR(45)  NOT NULL DEFAULT '',
  user_agent           VARCHAR(255) NOT NULL DEFAULT '',
  created_at           BIGINT       NOT NULL DEFAULT 0,
  updated_at           BIGINT       NOT NULL DEFAULT 0,
  completed_at         BIGINT       NOT NULL DEFAULT 0,
  KEY idx_recreq_user (user_id),
  KEY idx_recreq_status (status),
  KEY idx_recreq_created (created_at)
) ENGINE=InnoDB;

-- Every email notification the system generated (login alerts, recovery...).
CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  user_id    CHAR(36)     NOT NULL DEFAULT '',
  to_email   VARCHAR(160) NOT NULL DEFAULT '',
  type       VARCHAR(40)  NOT NULL DEFAULT '',
  subject    VARCHAR(200) NOT NULL DEFAULT '',
  body       MEDIUMTEXT   NULL,
  status     VARCHAR(20)  NOT NULL DEFAULT 'queued',   -- queued | sent | failed | skipped
  error      VARCHAR(255) NOT NULL DEFAULT '',
  created_at BIGINT       NOT NULL DEFAULT 0,
  KEY idx_notifications_user (user_id),
  KEY idx_notifications_created (created_at)
) ENGINE=InnoDB;

-- Audit trail: every operation users make, kept for the admin panel.
CREATE TABLE IF NOT EXISTS activity_log (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    CHAR(36)     NULL,
  user_name  VARCHAR(120) NOT NULL DEFAULT '',
  user_email VARCHAR(160) NOT NULL DEFAULT '',
  department VARCHAR(20)  NOT NULL DEFAULT '',
  role       VARCHAR(20)  NOT NULL DEFAULT '',
  action     VARCHAR(60)  NOT NULL DEFAULT '',
  entity     VARCHAR(40)  NOT NULL DEFAULT '',
  entity_id  VARCHAR(36)  NOT NULL DEFAULT '',
  details    TEXT         NULL,
  ip         VARCHAR(45)  NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  created_at BIGINT       NOT NULL DEFAULT 0,
  KEY idx_activity_created (created_at),
  KEY idx_activity_user (user_id),
  KEY idx_activity_action (action)
) ENGINE=InnoDB;
