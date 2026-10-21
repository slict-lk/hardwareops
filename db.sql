-- ============================================================
-- HardwareOps Optimizer — PostgreSQL Schema
-- Target: slict-slict.d.aivencloud.com:21354/hardwareops
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS bank_reconciliations CASCADE;
DROP TABLE IF EXISTS period_locks CASCADE;
DROP TABLE IF EXISTS budgets CASCADE;
DROP TABLE IF EXISTS fixed_assets CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS expense_categories CASCADE;
DROP TABLE IF EXISTS journal_lines CASCADE;
DROP TABLE IF EXISTS journal_entries CASCADE;
DROP TABLE IF EXISTS chart_of_accounts CASCADE;
DROP TABLE IF EXISTS shrink_incidents CASCADE;
DROP TABLE IF EXISTS rental_contracts CASCADE;
DROP TABLE IF EXISTS service_tickets CASCADE;
DROP TABLE IF EXISTS grn_lines CASCADE;
DROP TABLE IF EXISTS grns CASCADE;
DROP TABLE IF EXISTS po_lines CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS sale_lines CASCADE;
DROP TABLE IF EXISTS sales CASCADE;
DROP TABLE IF EXISTS invoice_lines CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
DROP TABLE IF EXISTS price_tiers CASCADE;
DROP TABLE IF EXISTS locations CASCADE;
DROP TABLE IF EXISTS tax_codes CASCADE;
DROP TABLE IF EXISTS uoms CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS payment_terms CASCADE;
DROP TABLE IF EXISTS number_series CASCADE;
DROP TABLE IF EXISTS auth_sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- ============================================================
-- ROLES & PERMISSIONS
-- ============================================================
CREATE TABLE roles (
    role_key    TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    description TEXT
);

INSERT INTO roles VALUES
 ('Owner',       'Owner',       '#9b59b6', 'Full access. Only role that can edit permissions.'),
 ('Manager',     'Manager',     '#E67E22', 'Everything except user management and permission editing.'),
 ('Cashier',     'Cashier',     '#3498db', 'POS, services, rentals only. No inventory or masters.'),
 ('Storekeeper', 'Storekeeper', '#27ae60', 'Inventory, PO, GRN, shrinkage. No POS or B2B credit.'),
 ('Accountant',  'Accountant',  '#D4A017', 'Read-only financials. B2B, invoices, GMROI, reports.');

CREATE TABLE role_permissions (
    role_key   TEXT NOT NULL REFERENCES roles(role_key) ON DELETE CASCADE,
    perm_key   TEXT NOT NULL,
    granted    BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (role_key, perm_key)
);

INSERT INTO role_permissions (role_key, perm_key, granted) VALUES
 ('Owner','dashboard',TRUE),('Owner','pos',TRUE),('Owner','inventory',TRUE),('Owner','po',TRUE),
 ('Owner','grn',TRUE),('Owner','services',TRUE),('Owner','rentals',TRUE),('Owner','b2b',TRUE),
 ('Owner','shrink',TRUE),('Owner','gmroi',TRUE),('Owner','analytics',TRUE),('Owner','masters',TRUE),
 ('Owner','masters_edit',TRUE),('Owner','numberseries',TRUE),('Owner','users_manage',TRUE),
 ('Owner','finance',TRUE),('Owner','finance_edit',TRUE),
 ('Manager','dashboard',TRUE),('Manager','pos',TRUE),('Manager','inventory',TRUE),('Manager','po',TRUE),
 ('Manager','grn',TRUE),('Manager','services',TRUE),('Manager','rentals',TRUE),('Manager','b2b',TRUE),
 ('Manager','shrink',TRUE),('Manager','gmroi',TRUE),('Manager','analytics',TRUE),('Manager','masters',TRUE),
 ('Manager','masters_edit',TRUE),('Manager','numberseries',TRUE),('Manager','users_manage',FALSE),
 ('Manager','finance',TRUE),('Manager','finance_edit',TRUE),
 ('Cashier','dashboard',FALSE),('Cashier','pos',TRUE),('Cashier','inventory',FALSE),('Cashier','po',FALSE),
 ('Cashier','grn',FALSE),('Cashier','services',TRUE),('Cashier','rentals',TRUE),('Cashier','b2b',FALSE),
 ('Cashier','shrink',FALSE),('Cashier','gmroi',FALSE),('Cashier','analytics',FALSE),('Cashier','masters',FALSE),
 ('Cashier','masters_edit',FALSE),('Cashier','numberseries',FALSE),('Cashier','users_manage',FALSE),
 ('Cashier','finance',FALSE),('Cashier','finance_edit',FALSE),
 ('Storekeeper','dashboard',TRUE),('Storekeeper','pos',FALSE),('Storekeeper','inventory',TRUE),('Storekeeper','po',TRUE),
 ('Storekeeper','grn',TRUE),('Storekeeper','services',FALSE),('Storekeeper','rentals',TRUE),('Storekeeper','b2b',FALSE),
 ('Storekeeper','shrink',TRUE),('Storekeeper','gmroi',FALSE),('Storekeeper','analytics',FALSE),('Storekeeper','masters',TRUE),
 ('Storekeeper','masters_edit',TRUE),('Storekeeper','numberseries',FALSE),('Storekeeper','users_manage',FALSE),
 ('Storekeeper','finance',FALSE),('Storekeeper','finance_edit',FALSE),
 ('Accountant','dashboard',TRUE),('Accountant','pos',FALSE),('Accountant','inventory',FALSE),('Accountant','po',FALSE),
 ('Accountant','grn',FALSE),('Accountant','services',FALSE),('Accountant','rentals',FALSE),('Accountant','b2b',TRUE),
 ('Accountant','shrink',FALSE),('Accountant','gmroi',TRUE),('Accountant','analytics',TRUE),('Accountant','masters',FALSE),
 ('Accountant','masters_edit',FALSE),('Accountant','numberseries',TRUE),('Accountant','users_manage',FALSE),
 ('Accountant','finance',TRUE),('Accountant','finance_edit',FALSE);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    role_key   TEXT NOT NULL REFERENCES roles(role_key),
    init       TEXT NOT NULL,
    email      TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    active     BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO users (name, role_key, init, email) VALUES
 ('Rick Alvarez',   'Owner',       'R', 'rick@store.lk'),
 ('Tina Pham',      'Manager',     'T', 'tina@store.lk'),
 ('Carlos Reyes',   'Cashier',     'C', 'carlos@store.lk'),
 ('Nina Brooks',    'Cashier',     'N', 'nina@store.lk'),
 ('Sunil Perera',   'Storekeeper', 'S', 'sunil@store.lk'),
 ('Amali Fernando', 'Accountant',  'A', 'amali@store.lk');

CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- NUMBER SERIES
-- ============================================================
CREATE TABLE number_series (
    code    TEXT PRIMARY KEY,
    prefix  TEXT NOT NULL,
    year    TEXT NOT NULL,
    next    INTEGER NOT NULL DEFAULT 1,
    pad     INTEGER NOT NULL DEFAULT 4,
    descr   TEXT NOT NULL
);

INSERT INTO number_series VALUES
 ('SALE','SL','2026',1,5,'POS Sale Receipt'),
 ('INV','INV','2026',2004,4,'B2B Invoice'),
 ('PO','PO','2026',3003,4,'Purchase Order'),
 ('GRN','GRN','2026',4002,4,'Goods Received Note'),
 ('SRV','SRV','2026',1005,4,'Service Ticket'),
 ('RNT','RNT','2026',5003,4,'Rental Contract'),
 ('SHR','SHR','2026',4,4,'Shrink Incident'),
 ('QUO','QUO','2026',1,4,'Quotation'),
 ('JE','JE','2026',1001,5,'Journal Entry'),
 ('EXP','EXP','2026',2001,5,'Expense Voucher');

-- Atomic next-number generator
CREATE OR REPLACE FUNCTION fn_next_number(p_code TEXT)
RETURNS TEXT AS $$
DECLARE
    v_prefix TEXT; v_year TEXT; v_next INTEGER; v_pad INTEGER;
BEGIN
    UPDATE number_series
       SET next = next + 1
     WHERE code = p_code
    RETURNING prefix, year, next - 1, pad
      INTO v_prefix, v_year, v_next, v_pad;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Number series % not found', p_code;
    END IF;
    RETURN v_prefix || '-' || v_year || '-' || LPAD(v_next::TEXT, v_pad, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- MASTERS
-- ============================================================
CREATE TABLE uoms (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    base_uom   TEXT REFERENCES uoms(code),
    factor     NUMERIC(14,4) NOT NULL DEFAULT 1,
    decimals   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO uoms (code,name,base_uom,factor,decimals) VALUES
 ('EA','Each',NULL,1,0),
 ('M','Meter',NULL,1,2),
 ('KG','Kilogram',NULL,1,3),
 ('L','Litre',NULL,1,2),
 ('SHT','Sheet',NULL,1,0);
INSERT INTO uoms VALUES
 ('BOX','Box','EA',100,0),
 ('PKT','Packet','EA',50,0),
 ('FT','Foot','M',0.3048,2),
 ('BAG','Bag','KG',50,0),
 ('BDL','Bundle','EA',10,0);

CREATE TABLE tax_codes (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rate NUMERIC(6,3) NOT NULL DEFAULT 0,
    ird  TEXT
);

INSERT INTO tax_codes VALUES
 ('VAT18','VAT Standard 18%',18,'VAT-STD'),
 ('VAT0','VAT Exempt 0%',0,'VAT-EXM'),
 ('VAT8','VAT Concession 8%',8,'VAT-CON'),
 ('NONE','No Tax',0,'-');

CREATE TABLE categories (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    margin NUMERIC(6,2) NOT NULL DEFAULT 30
);

INSERT INTO categories VALUES
 ('HWD','Hardware',30),('PLB','Plumbing',32),('ELC','Electrical',28),
 ('LMB','Lumber',18),('PNT','Paint',38),('CEM','Cement',12),
 ('STL','Steel',15),('TLS','Tools',30),('LWN','Lawn_Garden',35);

CREATE TABLE locations (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL
);

INSERT INTO locations VALUES
 ('SHOP','Shop Floor','Retail'),('BACK','Back Store','Warehouse'),
 ('YARD','Lumber Yard','Yard'),('TRK1','Lorry 1','Vehicle'),
 ('DMG','Damage Bin','Damage_Bin');

CREATE TABLE payment_terms (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    days INTEGER NOT NULL DEFAULT 0,
    disc NUMERIC(5,2) NOT NULL DEFAULT 0,
    cheque BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO payment_terms VALUES
 ('CASH','Cash',0,0,FALSE),
 ('COD','Cash on Delivery',0,0,TRUE),
 ('NET15','Net 15 Days',15,0,TRUE),
 ('NET30','Net 30 Days',30,0,TRUE),
 ('NET45','Net 45 Days',45,0,TRUE),
 ('NET60','Net 60 Days',60,0,TRUE),
 ('2-10NET30','2% 10 Days, Net 30',30,2,TRUE);

CREATE TABLE price_tiers (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    disc NUMERIC(5,2) NOT NULL DEFAULT 0,
    applies_to TEXT NOT NULL
);

INSERT INTO price_tiers VALUES
 ('RETAIL','Retail Walk-in',0,'B2C_DIY'),
 ('PRO','Contractor Pro',10,'B2B_Contractor'),
 ('WHLSL','Wholesale',15,'B2B_Commercial'),
 ('COMM','Commercial Project',18,'B2B_Commercial');

CREATE TABLE brands (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT,
    warranty_months INTEGER DEFAULT 0,
    distributor TEXT
);

INSERT INTO brands VALUES
 ('BOSCH','Bosch','Germany',12,'Hayleys Industrial'),
 ('STANLEY','Stanley','USA',24,'Sathosa Hardware'),
 ('TOKYO','Tokyo Cement','Sri Lanka',0,'Tokyo Cement Distributors'),
 ('APAINTS','Asian Paints','India',0,'Asian Paints Lanka'),
 ('CEYSTEEL','Ceylon Steel','Sri Lanka',0,'Ceylon Steel Corp'),
 ('GEN','Generic','-',0,'-');

CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    city TEXT,
    lead_days INTEGER NOT NULL DEFAULT 3,
    terms_code TEXT REFERENCES payment_terms(code)
);

INSERT INTO suppliers (name,city,lead_days,terms_code) VALUES
 ('Ceylon Hardware (Pvt) Ltd','Colombo',3,'NET30'),
 ('Lanka Pipes & Fittings','Colombo',4,'NET30'),
 ('Hayleys Industrial','Colombo',5,'NET30'),
 ('Browns Hardware','Colombo',6,'NET45'),
 ('Tokyo Cement Distributors','Colombo',4,'NET30'),
 ('Sathosa Hardware','Colombo',3,'COD'),
 ('Ceylon Steel Corp','Oruwala',5,'NET30'),
 ('Asian Paints Lanka','Colombo',4,'NET30');

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('B2C_DIY','B2B_Contractor','B2B_Commercial')),
    tier_code TEXT REFERENCES price_tiers(code),
    credit_limit NUMERIC(14,2) DEFAULT 0,
    credit_used NUMERIC(14,2) DEFAULT 0,
    points INTEGER DEFAULT 0,
    terms_code TEXT REFERENCES payment_terms(code)
);

INSERT INTO customers (name,type,tier_code,credit_limit,credit_used,points,terms_code) VALUES
 ('Perera Constructions (Pvt) Ltd','B2B_Contractor','PRO',500000,48500,0,'NET30'),
 ('Silva Electricals','B2B_Contractor','PRO',750000,128400,0,'NET30'),
 ('Nimal Fernando','B2C_DIY','RETAIL',0,0,320,'CASH'),
 ('Lanka Builders Ltd','B2B_Commercial','COMM',2500000,909500,0,'NET60'),
 ('Kamala Jayawardena','B2C_DIY','RETAIL',0,0,540,'CASH'),
 ('Ranjith Bandara','B2C_DIY','RETAIL',0,0,180,'CASH');

-- ============================================================
-- ITEMS & INVENTORY
-- ============================================================
CREATE TABLE items (
    sku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_code TEXT REFERENCES categories(code),
    brand_code TEXT REFERENCES brands(code),
    uom_code TEXT REFERENCES uoms(code),
    tax_code TEXT REFERENCES tax_codes(code),
    cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    reorder_point INTEGER NOT NULL DEFAULT 10,
    supplier_id INTEGER REFERENCES suppliers(id),
    location_code TEXT REFERENCES locations(code),
    last_sold DATE,
    active BOOLEAN DEFAULT TRUE
);

CREATE TABLE inventory (
    sku TEXT PRIMARY KEY REFERENCES items(sku) ON DELETE CASCADE,
    qty NUMERIC(14,3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INSERT INTO items (sku,name,category_code,brand_code,uom_code,tax_code,cost,price,reorder_point,supplier_id,location_code,last_sold)
-- SELECT v.sku, v.name, v.cat, v.brand, v.uom, v.tax, v.cost, v.price, v.reorder, s.id, v.loc, v.last_sold::DATE
-- FROM (VALUES
--  ('FST-001','1/4in Hex Bolt Zinc (Box)','HWD','GEN','BOX','VAT18',850,1490,10,'Ceylon Hardware (Pvt) Ltd','SHOP','2026-10-01'),
--  ('FST-002','3/8in Hex Nut (Box)','HWD','GEN','BOX','VAT18',620,1190,10,'Ceylon Hardware (Pvt) Ltd','SHOP','2026-09-12'),
--  ('PLB-101','1/2in PVC Elbow','PLB','GEN','EA','VAT18',45,129,50,'Lanka Pipes & Fittings','SHOP','2026-10-10'),
--  ('PLB-102','PVC Cement 500ml','PLB','GEN','EA','VAT18',410,899,15,'Lanka Pipes & Fittings','SHOP','2026-10-08'),
--  ('ELC-201','2.5mm² Copper Wire (100m)','ELC','GEN','BDL','VAT18',7800,11990,8,'Hayleys Industrial','BACK','2026-09-20'),
--  ('ELC-202','13A Twin Socket (UK)','ELC','GEN','EA','VAT18',110,279,40,'Hayleys Industrial','SHOP','2026-10-12'),
--  ('LMB-301','2x4x8 C24 Timber','LMB','GEN','EA','VAT18',420,749,100,'Browns Hardware','YARD','2026-10-14'),
--  ('LMB-302','3/4in Plywood 4x8','LMB','GEN','SHT','VAT18',3200,5299,20,'Browns Hardware','YARD','2026-09-28'),
--  ('PNT-401','Asian Paints White Emulsion 4L','PNT','APAINTS','L','VAT18',1450,3299,20,'Asian Paints Lanka','SHOP','2026-10-09'),
--  ('PNT-402','Asian Paints Base Tint 4L','PNT','APAINTS','L','VAT18',1800,3899,30,'Asian Paints Lanka','SHOP','2026-10-11'),
--  ('CEM-501','Tokyo Super Cement 50kg','CEM','TOKYO','BAG','VAT18',2350,2650,80,'Tokyo Cement Distributors','YARD','2026-10-14'),
--  ('CEM-502','Sanstha Cement 50kg','CEM','TOKYO','BAG','VAT18',2200,2500,40,'Tokyo Cement Distributors','YARD','2026-10-13'),
--  ('STL-601','12mm Tor Steel Bar (6m)','STL','CEYSTEEL','EA','VAT18',1450,1790,150,'Ceylon Steel Corp','YARD','2026-10-12'),
--  ('STL-602','Binding Wire 1kg','STL','CEYSTEEL','KG','VAT18',620,950,40,'Ceylon Steel Corp','YARD','2026-10-14'),
--  ('TLS-701','Bosch Impact Drill 13mm','TLS','BOSCH','EA','VAT18',12500,18900,5,'Hayleys Industrial','BACK','2026-10-13'),
--  ('TLS-702','Stanley Measuring Tape 5m','TLS','STANLEY','EA','VAT18',620,1290,40,'Sathosa Hardware','SHOP','2026-10-14'),
--  ('HRD-801','#8 x 1in Wood Screw (Box)','HWD','GEN','BOX','VAT18',480,899,20,'Ceylon Hardware (Pvt) Ltd','SHOP','2026-09-18')
-- ) AS v(sku,name,cat,brand,uom,tax,cost,price,reorder,supname,loc,last_sold)
-- JOIN suppliers s ON s.name = v.supname;

-- INSERT INTO inventory (sku,qty) VALUES
--  ('FST-001',42),('FST-002',8),('PLB-101',180),('PLB-102',22),('ELC-201',6),
--  ('ELC-202',95),('LMB-301',240),('LMB-302',18),('PNT-401',34),('PNT-402',55),
--  ('CEM-501',180),('CEM-502',65),('STL-601',320),('STL-602',88),('TLS-701',7),
--  ('TLS-702',88),('HRD-801',12);

-- ============================================================
-- PURCHASE ORDERS & GRN
-- ============================================================
CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    order_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'Sent'
        CHECK (status IN ('Draft','Sent','Partial','Received','Cancelled')),
    expected_date DATE,
    received_date DATE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE po_lines (
    id SERIAL PRIMARY KEY,
    po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    sku TEXT NOT NULL REFERENCES items(sku),
    qty NUMERIC(14,3) NOT NULL,
    cost NUMERIC(14,2) NOT NULL
);

CREATE TABLE grns (
    id TEXT PRIMARY KEY,
    po_id TEXT REFERENCES purchase_orders(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    date_received DATE NOT NULL,
    notes TEXT,
    paid BOOLEAN NOT NULL DEFAULT FALSE,
    amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
    received_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE grn_lines (
    id SERIAL PRIMARY KEY,
    grn_id TEXT NOT NULL REFERENCES grns(id) ON DELETE CASCADE,
    sku TEXT NOT NULL REFERENCES items(sku),
    qty NUMERIC(14,3) NOT NULL,
    cost NUMERIC(14,2) NOT NULL
);

-- ============================================================
-- SALES
-- ============================================================
CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    sale_date DATE NOT NULL,
    sale_time TIME,
    cashier_id INTEGER REFERENCES users(id),
    customer_id INTEGER REFERENCES customers(id),
    tier_code TEXT REFERENCES price_tiers(code),
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax NUMERIC(14,2) NOT NULL DEFAULT 0,
    total NUMERIC(14,2) NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL,
    tax_applied BOOLEAN NOT NULL DEFAULT TRUE,
    is_return BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_date ON sales(sale_date);
CREATE INDEX idx_sales_customer ON sales(customer_id);

CREATE TABLE sale_lines (
    id SERIAL PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    sku TEXT NOT NULL REFERENCES items(sku),
    qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
    unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    tax_code TEXT REFERENCES tax_codes(code),
    cost_at_sale NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX idx_sale_lines_sku ON sale_lines(sku);

-- ============================================================
-- INVOICES (B2B)
-- ============================================================
CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    invoice_date DATE NOT NULL,
    due_date DATE NOT NULL,
    total NUMERIC(14,2) NOT NULL,
    amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Unpaid'
        CHECK (status IN ('Unpaid','Partial','Paid','Overdue','Cancelled')),
    sale_id TEXT REFERENCES sales(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status ON invoices(status);

-- ============================================================
-- SERVICES
-- ============================================================
CREATE TABLE service_tickets (
    id TEXT PRIMARY KEY,
    service_type TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    date_in DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending','In_Progress','Ready','Picked_Up','Cancelled')),
    price NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RENTALS
-- ============================================================
CREATE TABLE rental_contracts (
    id TEXT PRIMARY KEY,
    tool_sku TEXT REFERENCES items(sku),
    tool_name TEXT NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    date_out DATE NOT NULL,
    date_due DATE NOT NULL,
    date_returned DATE,
    rate_per_day NUMERIC(14,2) NOT NULL DEFAULT 0,
    late_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SHRINKAGE
-- ============================================================
CREATE TABLE shrink_incidents (
    id TEXT PRIMARY KEY,
    incident_date DATE NOT NULL,
    sku TEXT REFERENCES items(sku),
    qty NUMERIC(14,3) NOT NULL,
    reason TEXT NOT NULL
        CHECK (reason IN ('Theft','Damage','Miscount','Vendor_Short','Unknown')),
    department TEXT,
    value NUMERIC(14,2) NOT NULL DEFAULT 0,
    logged_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TRIGGERS: stock deduction / addition
-- ============================================================
CREATE OR REPLACE FUNCTION trg_sale_line_apply()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE inventory SET qty = qty - NEW.qty, updated_at = NOW() WHERE sku = NEW.sku;
    UPDATE items SET last_sold = CURRENT_DATE WHERE sku = NEW.sku;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sale_lines_apply
AFTER INSERT ON sale_lines
FOR EACH ROW EXECUTE FUNCTION trg_sale_line_apply();

CREATE OR REPLACE FUNCTION trg_grn_line_apply()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE inventory SET qty = qty + NEW.qty, updated_at = NOW() WHERE sku = NEW.sku;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_grn_lines_apply
AFTER INSERT ON grn_lines
FOR EACH ROW EXECUTE FUNCTION trg_grn_line_apply();

CREATE OR REPLACE FUNCTION trg_shrink_apply()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE inventory SET qty = qty - NEW.qty, updated_at = NOW() WHERE sku = NEW.sku;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shrink_incidents_apply
AFTER INSERT ON shrink_incidents
FOR EACH ROW EXECUTE FUNCTION trg_shrink_apply();

-- -- ============================================================
-- -- SEED: POs, GRNs, Invoices, Services, Rentals, Shrink
-- -- ============================================================
-- INSERT INTO purchase_orders (id,supplier_id,order_date,status,expected_date,received_date)
-- VALUES
--  ('PO-2026-3001',(SELECT id FROM suppliers WHERE name='Ceylon Hardware (Pvt) Ltd'),'2026-10-12','Sent','2026-10-15',NULL),
--  ('PO-2026-3002',(SELECT id FROM suppliers WHERE name='Browns Hardware'),'2026-10-10','Received','2026-10-16','2026-10-14');

-- INSERT INTO po_lines (po_id,sku,qty,cost) VALUES
--  ('PO-2026-3001','FST-002',25,620),
--  ('PO-2026-3002','LMB-302',40,3200);

-- INSERT INTO grns (id,po_id,supplier_id,date_received,notes,received_by)
-- VALUES ('GRN-2026-4001','PO-2026-3002',
--  (SELECT id FROM suppliers WHERE name='Browns Hardware'),
--  '2026-10-14','All sheets intact',5);
-- INSERT INTO grn_lines (grn_id,sku,qty,cost) VALUES
--  ('GRN-2026-4001','LMB-302',40,3200);

-- INSERT INTO invoices (id,customer_id,invoice_date,due_date,total,status) VALUES
--  ('INV-2026-2001',(SELECT id FROM customers WHERE name='Perera Constructions (Pvt) Ltd'),'2026-10-01','2026-10-31',48500,'Paid'),
--  ('INV-2026-2002',(SELECT id FROM customers WHERE name='Silva Electricals'),'2026-10-05','2026-11-04',128400,'Unpaid'),
--  ('INV-2026-2003',(SELECT id FROM customers WHERE name='Lanka Builders Ltd'),'2026-10-10','2026-12-09',909500,'Unpaid');

-- INSERT INTO service_tickets (id,service_type,customer_id,date_in,status,price,notes) VALUES
--  ('SRV-2026-1001','Key_Cutting',(SELECT id FROM customers WHERE name='Nimal Fernando'),'2026-10-14','Ready',350,'3 copies KW1'),
--  ('SRV-2026-1002','Paint_Mix',(SELECT id FROM customers WHERE name='Kamala Jayawardena'),'2026-10-14','In_Progress',3899,'Emulsion cream tint'),
--  ('SRV-2026-1003','Pipe_Threading',(SELECT id FROM customers WHERE name='Perera Constructions (Pvt) Ltd'),'2026-10-14','Pending',1200,'3/4in GI pipe'),
--  ('SRV-2026-1004','Welding_Work',(SELECT id FROM customers WHERE name='Ranjith Bandara'),'2026-10-13','Ready',2500,'Gate hinge weld');

-- INSERT INTO rental_contracts (id,tool_sku,tool_name,customer_id,date_out,date_due,date_returned,rate_per_day) VALUES
--  ('RNT-2026-5001','TLS-701','Bosch Impact Drill 13mm',(SELECT id FROM customers WHERE name='Perera Constructions (Pvt) Ltd'),'2026-10-13','2026-10-16',NULL,4500),
--  ('RNT-2026-5002','TLS-702','Stanley Measuring Tape 5m',(SELECT id FROM customers WHERE name='Silva Electricals'),'2026-10-10','2026-10-12','2026-10-12',800);

-- -- Shrink incidents (apply trigger will deduct inventory)
-- INSERT INTO shrink_incidents (id,incident_date,sku,qty,reason,department,value,logged_by) VALUES
--  ('SHR-2026-0001','2026-09-20','TLS-701',1,'Theft','Tools',12500,5),
--  ('SHR-2026-0002','2026-09-28','ELC-201',1,'Damage','Electrical',7800,5),
--  ('SHR-2026-0003','2026-10-05','PLB-101',15,'Miscount','Plumbing',675,5);

CREATE TABLE chart_of_accounts (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('Asset','Liability','Equity','Revenue','COGS','Expense')),
    parent_code TEXT REFERENCES chart_of_accounts(code),
    postable BOOLEAN NOT NULL DEFAULT TRUE,
    contra BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO chart_of_accounts (code,name,account_type,parent_code,postable,contra) VALUES
 ('1100','Cash and Cash Equivalents','Asset',NULL,TRUE,FALSE),
 ('1110','Bank Current Account','Asset',NULL,TRUE,FALSE),
 ('1200','Accounts Receivable','Asset',NULL,TRUE,FALSE),
 ('1300','Inventory','Asset',NULL,TRUE,FALSE),
 ('1400','Cost of Goods Sold','COGS',NULL,TRUE,FALSE),
 ('1500','Fixed Assets','Asset',NULL,TRUE,FALSE),
 ('1510','Equipment','Asset','1500',TRUE,FALSE),
 ('1520','Vehicles','Asset','1500',TRUE,FALSE),
 ('1690','Accumulated Depreciation','Asset',NULL,TRUE,TRUE),
 ('2100','Accounts Payable','Liability',NULL,TRUE,FALSE),
 ('2200','VAT Payable','Liability',NULL,TRUE,FALSE),
 ('2210','VAT Receivable','Asset',NULL,TRUE,FALSE),
 ('2300','Customer Deposits','Liability',NULL,TRUE,FALSE),
 ('2400','Accrued Expenses','Liability',NULL,TRUE,FALSE),
 ('2500','Other Tax Payable','Liability',NULL,TRUE,FALSE),
 ('3000','Owners Equity','Equity',NULL,TRUE,FALSE),
 ('3100','Retained Earnings','Equity',NULL,TRUE,FALSE),
 ('3200','Owner Drawings','Equity',NULL,TRUE,TRUE),
 ('4100','Sales Revenue','Revenue',NULL,TRUE,FALSE),
 ('4200','Service Revenue','Revenue',NULL,TRUE,FALSE),
 ('4300','Rental Revenue','Revenue',NULL,TRUE,FALSE),
 ('4400','Other Income','Revenue',NULL,TRUE,FALSE),
 ('4900','Sales Returns','Revenue',NULL,TRUE,TRUE),
 ('5100','Operating Expenses','Expense',NULL,TRUE,FALSE),
 ('6100','Rent Expense','Expense',NULL,TRUE,FALSE),
 ('6200','Utilities Expense','Expense',NULL,TRUE,FALSE),
 ('6300','Travel Expense','Expense',NULL,TRUE,FALSE),
 ('6400','Supplies Expense','Expense',NULL,TRUE,FALSE),
 ('6500','Depreciation Expense','Expense',NULL,TRUE,FALSE),
 ('6600','Shrinkage Expense','Expense',NULL,TRUE,FALSE),
 ('6700','Bank Charges','Expense',NULL,TRUE,FALSE),
 ('6800','Repairs and Maintenance','Expense',NULL,TRUE,FALSE),
 ('6900','Other Expense','Expense',NULL,TRUE,FALSE)
 ON CONFLICT (code) DO NOTHING;

CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY,
    entry_date DATE NOT NULL,
    description TEXT NOT NULL,
    source TEXT NOT NULL,
    ref TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_lines (
    id SERIAL PRIMARY KEY,
    je_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
    debit NUMERIC(14,2) NOT NULL DEFAULT 0,
    credit NUMERIC(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE expense_categories (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_code TEXT NOT NULL DEFAULT '5100' REFERENCES chart_of_accounts(code)
);

INSERT INTO expense_categories (code, name, account_code) VALUES
 ('ELEC', 'Electricity', '6200'),
 ('RENT', 'Rent', '6100'),
 ('TRVL', 'Travel', '6300'),
 ('SUPP', 'Supplies', '6400')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    category_code TEXT REFERENCES expense_categories(code),
    expense_date DATE NOT NULL,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    vendor TEXT,
    notes TEXT,
    posted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fixed_assets (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    cost NUMERIC(14,2) NOT NULL DEFAULT 0,
    life_years INTEGER NOT NULL DEFAULT 1,
    salvage NUMERIC(14,2) NOT NULL DEFAULT 0,
    accumulated_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE budgets (
    period TEXT NOT NULL,
    account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (period, account_code)
);

CREATE TABLE period_locks (
    lock_through_date DATE PRIMARY KEY,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bank_reconciliations (
    id SERIAL PRIMARY KEY,
    je_line_id INTEGER NOT NULL REFERENCES journal_lines(id),
    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reconciled_by INTEGER REFERENCES users(id),
    UNIQUE (je_line_id)
);

CREATE OR REPLACE FUNCTION fn_post_journal(
    p_entry_date DATE,
    p_description TEXT,
    p_source TEXT,
    p_ref TEXT,
    p_lines JSONB,
    p_created_by INTEGER
) RETURNS TEXT AS $$
DECLARE
    v_je_id TEXT;
    v_debit NUMERIC(14,2) := 0;
    v_credit NUMERIC(14,2) := 0;
    v_line JSONB;
BEGIN
    IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) < 2 THEN
        RAISE EXCEPTION 'Journal entry requires at least two lines.';
    END IF;

    PERFORM pg_advisory_xact_lock(7319422);
    IF EXISTS (SELECT 1 FROM period_locks WHERE lock_through_date >= p_entry_date) THEN
        RAISE EXCEPTION 'Period is locked for backdated journal entries.' USING HINT = 'Use a date after the latest lock date.';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM chart_of_accounts
            WHERE code = (v_line->>'account_code')::TEXT AND postable
        ) THEN
            RAISE EXCEPTION 'Journal line account % does not exist or is not postable.',
                v_line->>'account_code';
        END IF;
        IF COALESCE((v_line->>'debit')::NUMERIC, 0) < 0
           OR COALESCE((v_line->>'credit')::NUMERIC, 0) < 0
           OR (COALESCE((v_line->>'debit')::NUMERIC, 0) > 0
               AND COALESCE((v_line->>'credit')::NUMERIC, 0) > 0) THEN
            RAISE EXCEPTION 'Journal line amounts must be non-negative and either debit or credit.';
        END IF;
        v_debit := v_debit + COALESCE((v_line->>'debit')::NUMERIC, 0);
        v_credit := v_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
    END LOOP;

    IF v_debit <= 0 OR ABS(v_debit - v_credit) > 0.009 THEN
        RAISE EXCEPTION 'Journal entry must balance.' USING HINT = 'Debits and credits must match.';
    END IF;

    v_je_id := fn_next_number('JE');

    INSERT INTO journal_entries (id, entry_date, description, source, ref, created_by)
    VALUES (v_je_id, p_entry_date, p_description, p_source, p_ref, p_created_by);

    INSERT INTO journal_lines (je_id, account_code, debit, credit)
    SELECT v_je_id,
           (line->>'account_code')::TEXT,
           COALESCE((line->>'debit')::NUMERIC, 0),
           COALESCE((line->>'credit')::NUMERIC, 0)
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) AS line;

    RETURN v_je_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_post_sale_finance(p_sale_id TEXT, p_created_by INTEGER DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
    v_sale sales%ROWTYPE;
    v_revenue NUMERIC(14,2);
    v_tax NUMERIC(14,2);
    v_cogs NUMERIC(14,2);
    v_lines JSONB;
    v_je_id TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('finance:POS:' || p_sale_id));
    SELECT id INTO v_je_id
      FROM journal_entries
     WHERE source = 'POS' AND ref = p_sale_id
     LIMIT 1;
    IF v_je_id IS NOT NULL THEN
        RETURN v_je_id;
    END IF;

    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale % not found.', p_sale_id;
    END IF;

    SELECT COALESCE(v_sale.subtotal - v_sale.discount, 0),
           COALESCE(v_sale.tax, 0),
           COALESCE(SUM(sl.qty * sl.cost_at_sale), 0)
      INTO v_revenue, v_tax, v_cogs
    FROM sale_lines sl
    WHERE sl.sale_id = p_sale_id;

    v_lines := jsonb_build_array(
        jsonb_build_object('account_code',
          CASE WHEN v_sale.payment_method = 'On Account (B2B)' THEN '1200' ELSE '1100' END,
          'debit', v_sale.total, 'credit', 0),
        jsonb_build_object('account_code','4100','debit', 0, 'credit', v_revenue),
        jsonb_build_object('account_code','2200','debit', 0, 'credit', v_tax),
        jsonb_build_object('account_code','1400','debit', v_cogs, 'credit', 0),
        jsonb_build_object('account_code','1300','debit', 0, 'credit', v_cogs)
    );

    v_je_id := fn_post_journal(
      v_sale.sale_date, 'POS sale ' || v_sale.id, 'POS', v_sale.id, v_lines,
      COALESCE(p_created_by, v_sale.cashier_id)
    );
    RETURN v_je_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_post_grn_finance(p_grn_id TEXT)
RETURNS TEXT AS $$
DECLARE
    v_lines JSONB;
    v_total NUMERIC(14,2);
    v_vat NUMERIC(14,2);
    v_date DATE;
    v_user INTEGER;
    v_je_id TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('finance:GRN:' || p_grn_id));
    SELECT id INTO v_je_id
      FROM journal_entries
     WHERE source = 'GRN' AND ref = p_grn_id
     LIMIT 1;
    IF v_je_id IS NOT NULL THEN
        RETURN v_je_id;
    END IF;

    SELECT g.date_received, g.received_by,
           COALESCE(SUM(gl.qty * gl.cost), 0),
           COALESCE(SUM(gl.qty * gl.cost * COALESCE(t.rate, 0) / 100), 0)
      INTO v_date, v_user, v_total, v_vat
      FROM grns g
      LEFT JOIN grn_lines gl ON gl.grn_id = g.id
      LEFT JOIN items i ON i.sku = gl.sku
      LEFT JOIN tax_codes t ON t.code = i.tax_code
     WHERE g.id = p_grn_id
     GROUP BY g.id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'GRN % not found.', p_grn_id;
    END IF;

    v_lines := jsonb_build_array(
        jsonb_build_object('account_code','1300','debit', v_total, 'credit', 0),
        jsonb_build_object('account_code','2210','debit', v_vat, 'credit', 0),
        jsonb_build_object('account_code','2100','debit', 0, 'credit', v_total + v_vat)
    );
    v_je_id := fn_post_journal(v_date, 'GRN ' || p_grn_id, 'GRN', p_grn_id, v_lines, v_user);
    RETURN v_je_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_grn_lines_finance()
RETURNS TRIGGER AS $$
DECLARE
    v_grn_id TEXT;
BEGIN
    FOR v_grn_id IN SELECT DISTINCT grn_id FROM inserted_grn_lines LOOP
        PERFORM fn_post_grn_finance(v_grn_id);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_post_service_finance(p_service_id TEXT)
RETURNS TEXT AS $$
DECLARE
    v_date DATE;
    v_price NUMERIC(14,2);
    v_je_id TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('finance:SERVICE:' || p_service_id));
    SELECT id INTO v_je_id FROM journal_entries
     WHERE source = 'SERVICE' AND ref = p_service_id LIMIT 1;
    IF v_je_id IS NOT NULL THEN RETURN v_je_id; END IF;

    SELECT date_in, price INTO v_date, v_price
      FROM service_tickets WHERE id = p_service_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service ticket % not found.', p_service_id; END IF;
    IF v_price <= 0 THEN RETURN NULL; END IF;

    RETURN fn_post_journal(v_date, 'Service ' || p_service_id, 'SERVICE', p_service_id,
      jsonb_build_array(
        jsonb_build_object('account_code','1200','debit',v_price,'credit',0),
        jsonb_build_object('account_code','4200','debit',0,'credit',v_price)
      ), NULL);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_service_finance()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_post_service_finance(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_post_rental_finance(p_rental_id TEXT)
RETURNS TEXT AS $$
DECLARE
    v_date DATE;
    v_amount NUMERIC(14,2);
    v_je_id TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('finance:RENTAL:' || p_rental_id));
    SELECT id INTO v_je_id FROM journal_entries
     WHERE source = 'RENTAL' AND ref = p_rental_id LIMIT 1;
    IF v_je_id IS NOT NULL THEN RETURN v_je_id; END IF;

    SELECT date_out,
           (GREATEST(date_due - date_out, 1) * rate_per_day) + late_fee
      INTO v_date, v_amount
      FROM rental_contracts WHERE id = p_rental_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rental contract % not found.', p_rental_id; END IF;
    IF v_amount <= 0 THEN RETURN NULL; END IF;

    RETURN fn_post_journal(v_date, 'Rental ' || p_rental_id, 'RENTAL', p_rental_id,
      jsonb_build_array(
        jsonb_build_object('account_code','1200','debit',v_amount,'credit',0),
        jsonb_build_object('account_code','4300','debit',0,'credit',v_amount)
      ), NULL);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_rental_finance()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_post_rental_finance(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_invoice_payment_finance()
RETURNS TRIGGER AS $$
DECLARE
    v_amount NUMERIC(14,2);
BEGIN
    v_amount := NEW.amount_paid - OLD.amount_paid;
    IF v_amount <= 0 THEN RETURN NEW; END IF;
    PERFORM fn_post_journal(CURRENT_DATE, 'AR receipt ' || NEW.id, 'AR', NEW.id,
      jsonb_build_array(
        jsonb_build_object('account_code','1100','debit',v_amount,'credit',0),
        jsonb_build_object('account_code','1200','debit',0,'credit',v_amount)
      ), NULL);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_expense_finance()
RETURNS TRIGGER AS $$
DECLARE
    v_account_code TEXT;
BEGIN
    IF NOT NEW.posted THEN RETURN NEW; END IF;
    SELECT account_code INTO v_account_code
      FROM expense_categories WHERE code = NEW.category_code;
    IF v_account_code IS NULL THEN
        RAISE EXCEPTION 'Expense category % has no ledger account.', NEW.category_code;
    END IF;
    PERFORM fn_post_journal(NEW.expense_date, 'Expense ' || NEW.id, 'EXPENSE', NEW.id,
      jsonb_build_array(
        jsonb_build_object('account_code',v_account_code,'debit',NEW.amount,'credit',0),
        jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount)
      ), NEW.created_by);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_finance ON sales;
DROP TRIGGER IF EXISTS trg_grn_finance ON grns;
DROP TRIGGER IF EXISTS trg_grn_lines_finance ON grn_lines;
DROP TRIGGER IF EXISTS trg_service_finance ON service_tickets;
DROP TRIGGER IF EXISTS trg_rental_finance ON rental_contracts;
DROP TRIGGER IF EXISTS trg_invoice_payment_finance ON invoices;
DROP TRIGGER IF EXISTS trg_expense_finance ON expenses;

CREATE OR REPLACE FUNCTION trg_shrink_finance()
RETURNS TRIGGER AS $$
DECLARE
    v_value NUMERIC(14,2);
    v_lines JSONB;
BEGIN
    v_value := COALESCE(NEW.value, 0);
    IF v_value <= 0 THEN RETURN NEW; END IF;
    v_lines := jsonb_build_array(
        jsonb_build_object('account_code','6600','debit', v_value, 'credit', 0),
        jsonb_build_object('account_code','1300','debit', 0, 'credit', v_value)
    );
    PERFORM fn_post_journal(NEW.incident_date, 'Shrink incident ' || NEW.id, 'SHRINK', NEW.id, v_lines, NEW.logged_by);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_grn_lines_finance
AFTER INSERT ON grn_lines
REFERENCING NEW TABLE AS inserted_grn_lines
FOR EACH STATEMENT EXECUTE FUNCTION trg_grn_lines_finance();

CREATE TRIGGER trg_shrink_finance
AFTER INSERT ON shrink_incidents
FOR EACH ROW EXECUTE FUNCTION trg_shrink_finance();

CREATE TRIGGER trg_service_finance
AFTER INSERT ON service_tickets
FOR EACH ROW EXECUTE FUNCTION trg_service_finance();

CREATE TRIGGER trg_rental_finance
AFTER INSERT ON rental_contracts
FOR EACH ROW EXECUTE FUNCTION trg_rental_finance();

CREATE TRIGGER trg_invoice_payment_finance
AFTER UPDATE OF amount_paid ON invoices
FOR EACH ROW
WHEN (NEW.amount_paid > OLD.amount_paid)
EXECUTE FUNCTION trg_invoice_payment_finance();

CREATE TRIGGER trg_expense_finance
AFTER INSERT ON expenses
FOR EACH ROW EXECUTE FUNCTION trg_expense_finance();

COMMIT;

-- ============================================================
-- ANALYTICS VIEWS
-- ============================================================
CREATE OR REPLACE VIEW v_item_sales AS
SELECT s.sale_date,
       sl.sku, i.name AS item_name, i.uom_code,
       SUM(sl.qty)                          AS qty_sold,
       SUM(sl.qty * sl.unit_price)          AS revenue,
       SUM(sl.qty * sl.cost_at_sale)        AS cost,
       SUM(sl.qty * (sl.unit_price - sl.cost_at_sale)) AS gross_profit
FROM sale_lines sl
JOIN sales s ON s.id = sl.sale_id
JOIN items i ON i.sku = sl.sku
WHERE s.is_return = FALSE
GROUP BY s.sale_date, sl.sku, i.name, i.uom_code;

CREATE OR REPLACE VIEW v_customer_credit AS
SELECT c.id, c.name, c.type,
       c.credit_limit, c.credit_used,
       c.credit_limit - c.credit_used AS available,
       COALESCE(SUM(i.total) FILTER (WHERE i.status <> 'Paid'),0) AS unpaid_total
FROM customers c
LEFT JOIN invoices i ON i.customer_id = c.id
WHERE c.type <> 'B2C_DIY'
GROUP BY c.id;

CREATE OR REPLACE VIEW v_supplier_purchases AS
SELECT s.id, s.name AS supplier,
       COUNT(po.id) AS po_count,
       COALESCE(SUM(pl.qty * pl.cost),0) AS total_value,
       COALESCE(SUM(pl.qty * pl.cost) FILTER (WHERE po.status='Received'),0) AS received_value,
       COALESCE(SUM(pl.qty * pl.cost) FILTER (WHERE po.status NOT IN ('Received','Cancelled')),0) AS open_value
FROM suppliers s
LEFT JOIN purchase_orders po ON po.supplier_id = s.id
LEFT JOIN po_lines pl ON pl.po_id = po.id
GROUP BY s.id, s.name;

CREATE OR REPLACE VIEW v_gmroi_category AS
SELECT c.code, c.name,
       SUM((i.price - i.cost) * inv.qty) AS gross_margin,
       SUM(i.cost * inv.qty)             AS avg_inventory,
       SUM(i.price * inv.qty)            AS retail_value,
       CASE WHEN SUM(i.cost * inv.qty) > 0
            THEN SUM((i.price - i.cost) * inv.qty) / SUM(i.cost * inv.qty)
            ELSE 0 END AS gmroi
FROM categories c
JOIN items i ON i.category_code = c.code
JOIN inventory inv ON inv.sku = i.sku
GROUP BY c.code, c.name;

-- ============================================================
-- STORED PROCEDURE: complete sale (POS checkout)
-- ============================================================
CREATE OR REPLACE FUNCTION sp_complete_sale(
    p_customer_id   INTEGER,
    p_cashier_id    INTEGER,
    p_payment       TEXT,
    p_tier_code     TEXT,
    p_tax_applied   BOOLEAN,
    p_lines         JSONB
) RETURNS TEXT AS $$
DECLARE
    v_sale_id  TEXT;
    v_subtotal NUMERIC(14,2) := 0;
    v_discount NUMERIC(14,2) := 0;
    v_tax      NUMERIC(14,2) := 0;
    v_total    NUMERIC(14,2) := 0;
    v_disc_pct NUMERIC(5,2)  := 0;
    v_line     JSONB;
    v_qty      NUMERIC(14,3);
    v_price    NUMERIC(14,2);
    v_cost     NUMERIC(14,2);
    v_tax_rate NUMERIC(6,3);
    v_tax_code TEXT;
    v_line_base NUMERIC(14,2);
BEGIN
    SELECT disc INTO v_disc_pct FROM price_tiers WHERE code = p_tier_code;
    IF v_disc_pct IS NULL THEN v_disc_pct := 0; END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_qty   := (v_line->>'qty')::NUMERIC;
        v_price := (v_line->>'unit_price')::NUMERIC;
        SELECT tax_code, cost INTO v_tax_code, v_cost FROM items WHERE sku = v_line->>'sku';
        v_subtotal := v_subtotal + v_qty * v_price;
    END LOOP;

    v_discount := v_subtotal * v_disc_pct / 100.0;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_qty   := (v_line->>'qty')::NUMERIC;
        v_price := (v_line->>'unit_price')::NUMERIC;
        SELECT tax_code INTO v_tax_code FROM items WHERE sku = v_line->>'sku';
        v_line_base := v_qty * v_price * (1 - v_disc_pct/100.0);
        IF p_tax_applied THEN
            SELECT rate INTO v_tax_rate FROM tax_codes WHERE code = v_tax_code;
            v_tax := v_tax + v_line_base * COALESCE(v_tax_rate,0) / 100.0;
        END IF;
    END LOOP;

    v_total := v_subtotal - v_discount + v_tax;
    v_sale_id := fn_next_number('SALE');

    INSERT INTO sales (id, sale_date, sale_time, cashier_id, customer_id, tier_code,
                       subtotal, discount, tax, total, payment_method, tax_applied)
    VALUES (v_sale_id, CURRENT_DATE, LOCALTIME, p_cashier_id, p_customer_id, p_tier_code,
            v_subtotal, v_discount, v_tax, v_total, p_payment, p_tax_applied);

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_qty   := (v_line->>'qty')::NUMERIC;
        v_price := (v_line->>'unit_price')::NUMERIC;
        SELECT tax_code, cost INTO v_tax_code, v_cost FROM items WHERE sku = v_line->>'sku';
        INSERT INTO sale_lines (sale_id, sku, qty, unit_price, tax_code, cost_at_sale)
        VALUES (v_sale_id, v_line->>'sku', v_qty, v_price, v_tax_code, v_cost);
    END LOOP;

    IF p_payment = 'On Account (B2B)' AND p_customer_id IS NOT NULL THEN
        UPDATE customers SET credit_used = credit_used + v_total WHERE id = p_customer_id;
        INSERT INTO invoices (id, customer_id, invoice_date, due_date, total, sale_id)
        SELECT fn_next_number('INV'), p_customer_id, CURRENT_DATE,
               CURRENT_DATE + (COALESCE(pt.days,30) || ' days')::INTERVAL, v_total, v_sale_id
        FROM customers c LEFT JOIN payment_terms pt ON pt.code = c.terms_code
        WHERE c.id = p_customer_id;
    END IF;

    PERFORM fn_post_sale_finance(v_sale_id, p_cashier_id);
    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql;