# Requirements Book: SharePoint Sensitivity Label Report

Version: **1.3 (Persistent Business Scope Configuration)**
Date: **2026-07-20**
Language: **Thai with English technical terms**  
Intended destination: **New standalone repository and new Codex thread**

## 1. จุดประสงค์ของเอกสาร

เอกสารนี้คือ requirement ฉบับ standalone สำหรับสร้างระบบรายงานไฟล์ที่ติด Microsoft Purview Sensitivity Label ใน SharePoint โดยเฉพาะ สามารถนำไฟล์นี้ไปวางใน repo ใหม่เป็น `REQUIREMENTS.md` แล้วเริ่มสนทนาใน thread ใหม่ได้โดยไม่ต้องอ่านประวัติของ SharePoint Permission Management repository เดิม

หากข้อความในเอกสารเก่าขัดกับเอกสารนี้ ให้ใช้เอกสารนี้เป็น source of truth สำหรับแอปใหม่

## 2. Executive Summary

ลูกค้าต้องการแอป Report แยกจากระบบ SharePoint Permission Management เดิม เพื่อดูว่าใน SharePoint sites ที่อยู่ใต้ขอบเขตความรับผิดชอบของผู้ใช้ มีไฟล์ที่ติด sensitivity labels ที่กำหนด เช่น `Confidential` และ `Secret` อยู่เท่าไรและมีไฟล์อะไรบ้าง

ระบบต้องมีคุณสมบัติหลักดังนี้:

- เป็นแอปใหม่สำหรับรายงานอย่างเดียว ไม่รวมอยู่ในหน้า Reviewer ของระบบเดิม
- ผู้ใช้แต่ละคนเห็นข้อมูลตาม hierarchy ที่ assign ให้ Entra user หรือ group
- SharePoint sites เป็น flat inventory แยกจาก hierarchy ของบริษัท และเชื่อมกันผ่าน explicit mapping
- EVP เห็นทุก site ที่ map อยู่ใต้ node และ descendants ของตนเท่านั้น ไม่ใช่ทั้ง tenant
- Department/Group/Project เห็นเฉพาะ branch ของตนและ descendants ที่ได้รับอนุญาต
- แสดงจำนวน Sensitive files ในแต่ละระดับ hierarchy, site และ document library
- Drill down ได้ถึงชื่อไฟล์และ path ไม่ใช่แค่จำนวน
- ไม่ scan แบบ real time ตอนเปิดหน้า
- Scheduled scanner scan ข้อมูลล่วงหน้าและเก็บ cached inventory
- Report app อ่าน cache และกรองข้อมูลตาม hierarchy scope
- ชื่อไฟล์และ path ของ Sensitive files ถือเป็น sensitive metadata ต้อง enforce scope ก่อนส่งข้อมูลจาก server
- Report web identity และ scheduled-scanner identity ต้องแยกจากกัน

## 3. Product Boundary และ Decision ที่ตกลงแล้ว

### 3.1 แอปเดิม

SharePoint Permission Management app เดิมยังคงทำหน้าที่:

- Grant/update/remove SharePoint permissions
- Permission Review
- Managed Sites
- Permission Audit Log

ห้ามแก้หรือย้ายฟังก์ชันเหล่านี้เพียงเพื่อสร้างระบบใหม่

### 3.2 แอปใหม่

สร้างแอปใหม่ชื่อชั่วคราว:

`SharePoint Sensitivity Label Report`

หน้าที่ของแอปใหม่:

- Authentication
- Hierarchy-scoped reporting
- Sensitive-file aggregate counts
- File-level sensitivity inventory
- Search/filter/export ตามสิทธิ์
- Scan status และ data freshness
- Hierarchy/config administration เฉพาะผู้มี capability

### 3.3 Scanner

Scheduled scanner เป็น background service แยกจาก Report web app:

- ทำงานโดยไม่ต้องมีผู้ใช้ login
- Scan SharePoint ตาม schedule
- เรียก Microsoft Graph สำหรับไฟล์ที่ต้องตรวจ
- เก็บผลลง inventory store
- เก็บ scan run, error และ delta/cursor state
- ห้ามส่ง app-only token หรือ scanner secret ไป browser

## 4. เป้าหมายและสิ่งที่ไม่อยู่ใน Scope

### 4.1 เป้าหมาย

- ให้ผู้บริหารเห็น Sensitive-file exposure ภายใน scope ของตนอย่างรวดเร็ว
- ให้ตัวเลขและ file details มาจาก cached inventory ชุดเดียวกัน
- รองรับหลาย SharePoint sites ใต้ผู้ใช้หนึ่งคน
- ลด Graph load ด้วย scheduled/incremental scan
- แยก deployment และ security boundary ออกจาก permission-management app เดิม
- เริ่มจาก prototype ที่ใช้ fixture ก่อนเชื่อม tenant จริง

### 4.2 Out of scope สำหรับ prototype แรก

- Real-time scan ตอนเปิดหน้า report
- การ assign/change/remove sensitivity label
- การเปลี่ยน SharePoint permission
- การแทนที่ Permission Review เดิม
- การ scan ทุก production site ตั้งแต่รอบแรก
- การให้สิทธิ์ report โดยอัตโนมัติจาก SharePoint Site Owner
- การถือว่า partial scan เป็น inventory ที่ครบถ้วน
- การเปิดไฟล์โดย bypass SharePoint permission

## 5. ผู้ใช้งานและ Authorization Model

ระบบต้องแยก `Capability` ออกจาก `Data Scope`

### 5.1 App roles/capabilities

ตัวอย่าง role ที่แอปใหม่อาจใช้:

| App role | ความสามารถ |
| --- | --- |
| `ReportAdmin` | ดู report, export, จัดการ hierarchy/configuration และส่ง Run now |
| `ReportViewer` | ดู report ภายใน hierarchy scope ของตน |

ชื่อ role สุดท้ายต้องยืนยันกับลูกค้าก่อน production แต่ prototype ใช้สอง role นี้ได้

### 5.2 Business role

ค่าเช่น `EVP`, `DepartmentHead`, `GroupManager`, `ProjectOwner` เป็น business metadata ใน hierarchy assignment ไม่ใช่ Entra app role โดยอัตโนมัติ

### 5.3 Hierarchy assignment

Hierarchy assignment เป็นตัวกำหนดว่า Entra user หรือ group ใดเห็น SharePoint sites ใด

```text
Signed-in Entra principal (user object ID/UPN and group object IDs)
-> active assignments
-> assigned node(s)
-> include descendants เมื่อกำหนดไว้
-> active hierarchy-to-site mappings
-> distinct allowed site IDs
-> cached inventory filtered to allowed sites
```

ผู้ใช้ต้องมีทั้ง capability ที่อนุญาตให้ดู report และ active hierarchy assignment จึงจะเห็นข้อมูล หากมี `ReportViewer` แต่ไม่มี assignment ต้องเห็น empty/denied state และห้ามเห็น inventory Production ควรใช้ immutable Entra object ID เป็นหลัก โดยเก็บ UPN/display name เพื่อค้นหาและแสดงผลเท่านั้น

## 6. Hierarchy Model

Default organization model เป็น forest ที่มี EVP roots ได้หลายคน:

```text
EVP A                         EVP B
└── Department A             └── Department B
    └── Group A                  └── Group B
        └── Project A                └── Project B
```

Hierarchy นี้คือโครงสร้างตำแหน่ง/หน่วยงานของบริษัทลูกค้า ไม่ใช่โครงสร้างของ SharePoint ทุก node เป็นขอบเขตทางธุรกิจเท่านั้น ระดับจริงอาจเปลี่ยนชื่อได้ตามโครงสร้างลูกค้า แต่ prototype ต้องรองรับอย่างน้อย:

- EVP
- Department
- Group
- Project

สำหรับ requirement ปัจจุบัน parent chain ต้องเป็น `EVP -> Department -> Group -> Project`
เท่านั้น: EVP ไม่มี parent, Department อยู่ใต้ EVP, Group อยู่ใต้ Department และ Project อยู่ใต้
Group แต่ละ node อยู่ใน EVP tree เดียว และการ traverse descendants ต้องไม่ข้ามไปยัง EVP root อื่น

### 6.1 SharePoint Site mapping

SharePoint sites เป็นรายการแบบ flat และต้องเก็บแยกจาก hierarchy node:

```text
Business hierarchy node(s)
        ↓ explicit mapping
Flat SharePoint Site inventory
```

- หนึ่ง hierarchy node map ได้ 0–หลาย sites
- Site หนึ่งควรมี canonical active placement เดียวใน prototype
- Site record ต้องมี Site ID, display name, hostname/path, active state และ scheduled-scan state
- การย้าย Site ระหว่างหน่วยงานคือการแก้ mapping ไม่ใช่การแก้ parent/child ของ Site
- Hierarchy traversal ให้ visible node IDs ก่อน แล้วจึง resolve allowed site IDs ผ่าน mapping
- การมี Site อยู่ใน scan registry หรือ cache เพียงอย่างเดียวไม่ให้สิทธิ์ดู Site ต้องมี active mapping
  อยู่ใน visible descendants ของ assignment เสมอ

### 6.2 Expected visibility

| Assignment | Scope ที่ต้องเห็น |
| --- | --- |
| EVP ที่ root ของตน | ทุก active site ที่ map อยู่ใน descendants ของ EVP tree นั้นเท่านั้น |
| Department Head | ทุก site ใน Department branch ของตน |
| Group Manager | ทุก site ใน Group branch ของตน |
| Project Owner | Sites ที่ map กับ Project node ของตนเท่านั้น เว้นแต่มี assignment เพิ่ม |
| หลาย assignments | Union ของทุก allowed site โดยไม่ซ้ำ |
| ไม่มี assignment | ไม่เห็น inventory |

EVP ไม่ใช่ tenant-wide report administrator โดยอัตโนมัติ และต้องไม่เห็น Site ที่ map อยู่ใต้ EVP
root อื่นหรือ Site ที่ยังไม่มี business mapping แม้ Site นั้นจะ active อยู่ใน `ScannerSites`

### 6.3 Hierarchy และ Site mapping validation

ระบบต้องตรวจและปฏิเสธ configuration ที่มี:

- Duplicate node IDs
- Parent node ที่ไม่มีอยู่
- Cycle
- Node ที่อ้างตัวเองเป็น parent
- Invalid hostname/path
- Assignment ที่อ้าง node ไม่มีอยู่
- Duplicate Site IDs
- Site hostname/path ไม่ถูกต้อง
- Mapping ที่อ้าง node หรือ Site ไม่มีอยู่
- Duplicate mapping หรือ Site มีหลาย active canonical placements
- User assignment ที่ไม่มี Entra object ID หรือ UPN ที่ถูกต้อง และ Group assignment ที่ไม่มี Entra object ID
- Parent type ผิดลำดับจาก `EVP -> Department -> Group -> Project`
- EVP ที่มี parent หรือ node ระดับอื่นที่ไม่มี parent ตามชนิดของตน

Inactive node หรือ inactive assignment ต้องไม่เพิ่ม scope

## 7. Functional Requirements: Report

### FR-001: Scope summary

หน้าแรกต้องแสดงจำนวน Sensitive files ทั้งหมดภายใน resolved scope ของผู้ใช้ โดยนับไฟล์ที่มี label ID อยู่ใน configured reportable label IDs

### FR-002: Hierarchy aggregates

ต้องคำนวณจำนวน Sensitive files แยกตาม hierarchy node ที่ผู้ใช้เห็น เช่น EVP, Department, Group และ Project เพื่อใช้พิสูจน์ authorization, filter และ reconciliation

หน้าหลักไม่จำเป็นต้อง render hierarchy tree ทั้งชุด ให้แสดง compact resolved-scope proof ว่า assignment ใดรวม descendants และ resolve ไปยัง Sites จำนวนเท่าใด ส่วนรายละเอียด hierarchy rollup ใช้ผ่าน authorized filters, admin/configuration view หรือ tests ตามงานที่ผู้ใช้ต้องทำ

### FR-003: Site aggregates

ต้องแสดงจำนวน Sensitive files แยกตาม SharePoint site

### FR-004: Library aggregates

ต้องแสดงจำนวน Sensitive files แยกตาม document library

### FR-005: File-level drill-down

ผู้ใช้ต้อง drill down ถึงรายการไฟล์ได้ โดยอย่างน้อยต้องมี:

- File name
- File path
- Site name
- Site URL/identity
- Document library
- Sensitivity label ID
- Sensitivity label display name เมื่อ resolve ได้
- Assignment method เมื่อ API ส่งกลับ
- Modified time เมื่อมีข้อมูล
- Last scanned time
- Scan status
- Optional SharePoint web URL

### FR-006: Search and filters

ต้องค้นหาและกรองได้อย่างน้อยตาม:

- Hierarchy node
- Site
- Library
- File name
- Label
- Scan status
- Last scanned/freshness

### FR-007: Cached-data status

หน้า report ต้องแสดง:

- Last successful scan
- Next scheduled scan เมื่อทราบ
- Data freshness/current/stale state
- Scanned item count
- Sensitive-file count
- No-label count เมื่อแสดงใน admin status
- Locked/unsupported/failed/throttled counts
- Partial/incomplete warning

### FR-008: Export

เมื่อเปิด capability export ผู้ใช้ต้อง export ได้เฉพาะ rows ภายใน resolved scope และ filters ปัจจุบัน ห้ามให้ client ดาวน์โหลด inventory ทั้งหมดแล้วค่อยกรองเอง

### FR-009: Direct file link

อาจแสดงลิงก์ SharePoint file หลัง security review การเห็น metadata ใน report ไม่ได้ให้สิทธิ์เปิดไฟล์ SharePoint ยังคงเป็นผู้ตรวจ file access จริง

### FR-010: Empty and denied states

ต้องแยกข้อความกรณี:

- ไม่มี hierarchy assignment
- มี scope แต่ยังไม่มี completed scan
- Scan สำเร็จและไม่มี Sensitive file ตาม configured reportable label IDs
- Scan partial หรือ stale
- ระบบอ่าน cache ไม่ได้

## 8. Aggregation Semantics

### 8.1 Stable file key

ใช้ stable key ต่อไฟล์:

```text
tenantId + siteId + driveId + itemId
```

### 8.2 Counting rules

- Hierarchy-node subtotal รวม distinct Sensitive files จาก sites ของ node และ visible descendants
- Site subtotal รวม distinct Sensitive files จาก visible libraries ใน site
- Library subtotal รวม distinct Sensitive files ใน library
- หนึ่งไฟล์นับครั้งเดียวต่อ aggregate แม้ API ส่งหลาย labels
- หากไฟล์มี label ใดที่อยู่ใน configured reportable label IDs ให้นับเป็น Sensitive หนึ่งไฟล์
- ห้ามพึ่ง label display name เพียงอย่างเดียว เพราะชื่อสามารถเปลี่ยนได้
- แต่ละ Site ควรมี canonical active hierarchy-to-site mapping หนึ่งตำแหน่ง
- หากธุรกิจต้องวาง site เดียวในหลาย nodes ต้อง deduplicate ด้วย stable file key
- จำนวนที่แสดงต้อง reconcile กับ file-detail rows สำหรับ scope และ filters เดียวกัน

### 8.3 Deleted/moved files

- Deleted file ต้องถูก mark/remove จาก active inventory เมื่อ delta scan ตรวจพบ
- Moved/renamed file ต้องอัปเดต path/name โดยคง item identity เมื่อ Graph identity ไม่เปลี่ยน
- Report ต้องไม่รวม deleted/inactive records ใน current counts

## 9. Functional Requirements: Scheduled Scanner

### SCAN-001: No page-load scan

Report request ห้าม enumerate files หรือเรียก `extractSensitivityLabels` ต่อไฟล์

### SCAN-002: Initial baseline

ต้องรองรับ initial full scan สำหรับ allowlisted sites

### SCAN-003: Incremental schedule

หลัง baseline ให้ใช้ incremental/delta processing เพื่อตรวจไฟล์ใหม่ เปลี่ยนแปลง ย้าย หรือลบ

Schedule ต้องอ่าน active `scanEnabled` sites จาก flat Site inventory โดยไม่ขึ้นกับผู้ใช้ที่เปิด Report หรือ business role ที่ login อยู่

Recommended starting cadence ซึ่งต้องยืนยันกับลูกค้า:

- Nightly incremental scan นอก peak hours
- Weekly full reconciliation หรือ controlled rescan

### SCAN-004: Shared inventory

Site/file หนึ่งชุด scan ครั้งเดียวต่อรอบ ไม่ scan ซ้ำตาม EVP/Department/Group/Project หรือผู้ใช้แต่ละคน

Hierarchy-to-site mapping ใช้ตอนอ่าน Report เท่านั้น ห้ามนำจำนวน hierarchy assignments ไปคูณจำนวน scan jobs

### SCAN-005: Run now

`Run now` สำหรับ ReportAdmin ต้องสร้าง queued job และตอบกลับทันที ห้าม hold browser request จน scan เสร็จ

### SCAN-006: Graph extraction

สำหรับ supported changed files ให้เรียก:

```text
POST /drives/{drive-id}/items/{item-id}/extractSensitivityLabels
```

ผลที่ต้องเก็บอย่างน้อย:

- Sensitivity label IDs
- Assignment method
- Tenant ID เมื่อมี
- Extraction outcome
- Scan timestamp
- Graph request/correlation ID เมื่อมี

### SCAN-007: Failure handling

รองรับสถานะ:

- `success`
- `no-label`
- `unsupported`
- `locked`
- `throttled`
- `failed`

ต้อง retry แบบ bounded สำหรับ `429`, selected `503/5xx` และ transient network failures โดย respect `Retry-After` เมื่อ Graph ส่งมา

ไฟล์ที่ตอบ `423 Locked` หรือ extraction error ต้องบันทึกเป็น item outcome และไม่ทำให้ scan ทั้ง run ล้มโดยอัตโนมัติ

### SCAN-008: Bounded concurrency

ต้องจำกัดจำนวน Graph requests ที่ทำพร้อมกันและปรับค่าได้ ห้ามยิงทุกไฟล์พร้อมกัน

### SCAN-009: Scan-run record

แต่ละ run ต้องเก็บ:

- Run ID
- Trigger type: schedule/manual/reconciliation
- Started/finished timestamps
- Status: queued/running/succeeded/partial/failed/cancelled
- Target sites
- Scanned/changed/sensitive/no-label/locked/throttled/unsupported/failed counts
- Error summary
- Cursor/delta state result

### SCAN-010: Idempotency

การ retry run หรือ item ต้อง upsert ด้วย stable identity และไม่สร้าง duplicate current inventory rows

## 10. Proposed Architecture

```text
Microsoft Entra ID
├── Report Web App Registration
│   └── Interactive sign-in and app roles
└── Scanner Identity/App Registration
    └── Background application permission

Report Web App
├── Authenticate user
├── Resolve UPN hierarchy scope
├── Query scoped cached aggregates
├── Query scoped file rows
└── Export scoped rows

Scheduled Scanner Worker
├── Timer trigger
├── Admin Run-now queue consumer
├── Microsoft Graph drive/delta/extraction client
├── Retry and bounded concurrency
└── Inventory/scan-state writer

Stores
├── Hierarchy nodes
├── User assignments
├── Flat SharePoint Site inventory
├── Hierarchy-to-site mappings
├── Sensitivity inventory
├── Scan runs
└── Per-drive delta/cursor state
```

### 10.1 Identity separation

- Report Web App Registration ใช้ interactive login และ app roles
- Scanner identity ใช้ background application access ที่ลูกค้าอนุมัติ
- Scanner secret/certificate/managed identity ห้ามอยู่ใน `NEXT_PUBLIC_*`, browser bundle หรือ client storage
- Redirect URIs และ deployment lifecycle ของแอปใหม่แยกจาก permission-management app เดิม

### 10.2 Suggested Azure components

ตัวเลือกเริ่มต้น:

- Report web: Next.js on Azure App Service
- Scanner: Azure Functions Timer Trigger + Queue Trigger
- Secrets: Managed Identity/Key Vault ตาม customer policy
- Telemetry: Application Insights/OpenTelemetry
- Inventory: storage interface โดยตัดสิน backend หลังวัด volume

ส่วนนี้เป็น proposed architecture ไม่ใช่ข้อบังคับจนกว่าจะจบ prototype measurement

## 11. Data Contracts

### 11.1 Hierarchy node

```ts
type GovernanceHierarchyNode = {
  id: string;
  parentId?: string;
  type: "EVP" | "Department" | "Group" | "Project";
  name: string;
  active: boolean;
};
```

### 11.2 Flat SharePoint Site และ mapping

```ts
type GovernedSharePointSite = {
  id: string;
  name: string;
  hostname: string;
  path: string;
  active: boolean;
  scanEnabled: boolean;
};

type GovernanceHierarchySiteMapping = {
  nodeId: string;
  siteId: string;
  active: boolean;
};
```

### 11.3 User assignment

```ts
type GovernanceHierarchyAssignment = {
  userUpn: string;
  nodeId: string;
  businessRole:
    | "EVP"
    | "DepartmentHead"
    | "GroupManager"
    | "ProjectOwner"
    | "Delegate";
  includeDescendants: boolean;
  active: boolean;
};
```

### 11.4 Sensitivity inventory item

```ts
type SensitivityInventoryItem = {
  tenantId: string;
  siteId: string;
  driveId: string;
  itemId: string;
  siteName: string;
  siteWebUrl?: string;
  libraryName: string;
  fileName: string;
  filePath: string;
  fileWebUrl?: string;
  modifiedAt?: string;
  sensitivityLabels: Array<{
    id: string;
    displayName?: string;
    assignmentMethod?: string;
    tenantId?: string;
  }>;
  scanStatus:
    | "success"
    | "no-label"
    | "unsupported"
    | "locked"
    | "throttled"
    | "failed";
  scannedAt: string;
  deletedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  graphRequestId?: string;
};
```

### 11.5 Scan run

```ts
type SensitivityScanRun = {
  id: string;
  trigger: "schedule" | "manual" | "reconciliation";
  status: "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
  startedAt?: string;
  finishedAt?: string;
  targetSiteIds: string[];
  scannedCount: number;
  changedCount: number;
  sensitiveCount: number;
  noLabelCount: number;
  lockedCount: number;
  throttledCount: number;
  unsupportedCount: number;
  failedCount: number;
  errorSummary?: string;
};
```

## 12. Storage Decision

### Prototype P0-P3

- ใช้ deterministic fixtures
- ใช้ repository/store interfaces
- UI ห้าม import fixture โดยตรงจาก component หากทำให้เปลี่ยน storage ยาก

### Graph pilot P4

- SharePoint Lists ใช้ได้สำหรับข้อมูลจำนวนน้อยและทดสอบหนึ่ง site
- ต้องวัดจำนวนไฟล์, write rate, query pattern และเวลาสร้าง aggregates

### Scheduled pilot P5/Production

- Hierarchy/configuration/scan history อาจเก็บใน SharePoint Lists หากเหมาะสม
- Per-file inventory จำนวนมากควรพิจารณา Azure SQL, Cosmos DB หรือ Azure Table Storage
- ห้ามผูก UI component กับ storage technology โดยตรง
- ต้องรองรับ pagination และ indexed queries ตาม scope/site/label/status

## 13. Security Requirements

### SEC-001: Server-side scope enforcement

Backend/data access layer ต้อง resolve allowed sites จาก UPN และกรองก่อนตอบ aggregate, file rows หรือ export

### SEC-002: Fail closed

หาก hierarchy store อ่านไม่ได้, assignment ไม่ชัดเจน หรือ scope resolution error ให้ปฏิเสธข้อมูล ห้าม fallback เป็น all sites

### SEC-003: Sensitive metadata

Sensitive file names, paths, sites และ labels ถือเป็น sensitive metadata ต้องไม่ถูก log แบบไม่จำเป็นและห้ามส่งนอก scope

### SEC-004: Scanner isolation

Scanner credentials/application token ต้องอยู่เฉพาะ trusted server/worker environment

### SEC-005: Least privilege review

ก่อน P4 ต้องบันทึก Graph permissions ที่ต้องใช้, เหตุผล, app-only/delegated model, admin consent และ allowlisted test site

### SEC-006: File access remains in SharePoint

Report authorization ให้สิทธิ์เห็น metadata ตาม business scope ไม่ได้ bypass SharePoint file access

### SEC-007: Export control

Export ต้องมี capability check, scope filtering และ audit event

### SEC-008: Audit

อย่างน้อยต้อง audit:

- Login success/failure ตามนโยบาย
- Report view/refresh ที่สำคัญ
- Export
- Hierarchy/config changes
- Run-now request
- Scanner run result
- Authorization denied

## 14. Non-Functional Requirements

### NFR-001: Cached report performance

หน้า report ต้องอ่าน cache/indexed store และห้ามรอ Graph file scan เป้าหมาย response time ต้องกำหนดหลังวัด prototype dataset

### NFR-002: Pagination

File-level report ต้องใช้ server-side pagination ห้ามโหลด inventory ทั้งหมดเข้า browser

Site Explorer ต้องค้นหาและ paginate flat Site inventory ตาม resolved scope ห้าม render Sites หลักร้อยหรือหลักพันเป็น expanded hierarchy tree

### NFR-003: Reliability

Partial scan ต้องแสดงเป็น partial ห้ามรายงานว่า complete

### NFR-004: Observability

ต้องมี structured logs, run IDs, Graph request IDs เมื่อมี, failure metrics และ scan-duration metrics

### NFR-005: Accessibility

Summary, filters, resolved-scope proof, Site Explorer และ file table ต้องใช้ keyboard ได้และมี accessible labels

### NFR-006: Tenant neutrality

ห้าม hard-code tenant IDs, domains, site URLs, label IDs หรือ user UPNs เป็น production defaults

### NFR-007: Testability

Hierarchy, aggregation, authorization และ scanner orchestration ต้องแยกเป็น testable pure/domain services เท่าที่ทำได้

### NFR-008: Deployment isolation

การ build/deploy/rollback แอปใหม่ต้องไม่ build หรือ deploy permission-management app เดิม

### NFR-009: Production maintainability

- แยก domain, Microsoft Graph transport/authentication, scanner orchestration และ storage adapters ผ่าน typed contracts
- Configuration ต้อง validate แบบ fail closed ตอนเริ่ม worker และห้ามมี tenant-specific production default
- Retry, concurrency, timeouts, schema changes และ operational behavior ต้องปรับค่าและทดสอบได้
- Structured logs ห้ามมี access token, secret หรือ file metadata เกินจำเป็น
- การเปลี่ยน inventory/schema ต้องมี migration/backward-compatibility plan
- ต้องมี automated tests, dependency vulnerability review, runbook และ ADR สำหรับ production-critical decisions

## 15. Prototype Plan

### P0: Repository and safety baseline

- สร้าง repo ใหม่
- นำไฟล์นี้ไปเป็น `REQUIREMENTS.md`
- ตั้ง lint, unit test, type check และ production build
- ยังไม่ขอ Graph permission จริง
- บันทึก architecture decision ว่า web app และ scanner แยก identity

Exit gate:

- Empty/new app pipeline ผ่าน
- ไม่มี dependency กับ permission-management repo เดิม

### P1: Domain and hierarchy fixtures

- Implement hierarchy types/validation
- Implement descendant traversal
- Implement UPN assignment resolution
- Implement flat SharePoint Site records และ hierarchy-to-site mappings แยกจาก hierarchy nodes
- Implement multi-label reportable ID configuration
- Implement aggregate calculation and deduplication
- สร้าง fixture อย่างน้อย 1 EVP, 2 Departments, หลาย Groups/Projects และ 5 users

Required tests:

- EVP sees all descendants
- Department sees only own branch
- Group sees only own branch
- Project sees only own site
- Multiple assignments union without duplicates
- No assignment returns no data
- Inactive node/assignment excluded
- Missing parent and cycle rejected
- Cross-branch access denied
- Counts reconcile with file rows

### P2: Report-only UI prototype

- Interactive login can be mocked initially
- Role and UPN selector for deterministic demo mode
- Compact resolved-scope proof ที่แสดง assignment → descendants → จำนวน visible Sites
- Hierarchy rollups ที่ server คำนวณและทดสอบได้ โดยไม่ต้อง render tree ทั้งชุดบนหน้าหลัก
- Site/library counts
- File-name drill-down
- Search/filter/pagination
- Freshness/partial/error states
- Scoped export simulation

Exit gate:

- Demo EVP/Department/Group/Project views match expected fixtures
- Request parameter manipulation cannot return out-of-scope fixture rows
- Counts equal filtered file details

### P3: Scanner and store contracts

- Scanner interface
- Inventory store interface
- Hierarchy store interface
- Scan-run store interface
- Delta-state store interface
- Simulate scheduled run, partial run, locked files and retryable failure
- UI reads only store/cache contracts

Exit gate:

- End-to-end fixture demo works without Microsoft Graph
- No per-file scan occurs during report requests

### Review checkpoint before real Graph

Customer/team must approve:

- Hierarchy naming and sample tree
- ตัวอย่าง Site inventory และ canonical mapping จาก business nodes ไปยัง Sites
- Which label IDs are reportable and their approved display names/classification order
- File columns and direct-link behavior
- Schedule cadence
- Export permission
- Scanner Graph permissions
- Test site allowlist
- Expected file volume and storage choice

### P4: One-site Graph pilot

- Separate scanner identity
- One non-production allowlisted site
- Production Graph adapter และ Azure Identity token provider หลัง typed contracts
- Fail-closed configuration, safe logging และ dependency-injected transport/stores
- Controlled supported test files
- Real extractSensitivityLabels calls
- Persist real outcomes
- Measure duration, throughput, throttling and storage volume

Exit gate:

- Cached file-level labels and counts match manually verified test files
- Locked/unsupported/failure cases are visible
- No production-wide permission expansion

### P5: Scheduled Azure pilot

- Timer/queue worker
- Nightly incremental scan
- Weekly reconciliation
- Admin Run-now queue
- Telemetry and alerts
- Secrets/identity hardening
- Production storage decision

## 16. Acceptance/UAT Scenarios

| ID | Scenario | Expected result |
| --- | --- | --- |
| UAT-01 | EVP login | เห็น Sensitive totals และ files จากทุก descendant site |
| UAT-02 | Department login | ไม่เห็น sibling department |
| UAT-03 | Group login | เห็นเฉพาะ group branch |
| UAT-04 | Project login | เห็นเฉพาะ Sites ที่ map กับ Project node |
| UAT-05 | No assignment | ไม่เห็น inventory |
| UAT-06 | Filter by site/library | Count และ file rows reconcile |
| UAT-07 | Search file name | คืนเฉพาะ in-scope matching files |
| UAT-08 | Manipulate request scope | Server ปฏิเสธ/ไม่คืน out-of-scope data |
| UAT-09 | Export | Export เฉพาะ scoped/filtered rows |
| UAT-10 | Partial scan | แสดง partial warning และ failure counts |
| UAT-11 | Locked file | Scan run ไม่ล้มทั้งชุดและ file outcome เป็น locked |
| UAT-12 | Stale inventory | แสดง last scan และ stale state |
| UAT-13 | Run now | ได้ queued job ไม่ค้าง browser |
| UAT-14 | Direct link | SharePoint ยัง enforce file permission |
| UAT-15 | Existing app | Permission-management app เดิมไม่ได้รับผลกระทบ |
| UAT-16 | Filter by label | แยก Confidential และ Secret ได้โดยอิง configured label IDs |

## 17. Definition of Done

### Prototype P0-P3 ถือว่าเสร็จเมื่อ

- Repo ใหม่ build, lint, type check และ unit tests ผ่าน
- Hierarchy resolver tests ผ่านครบ
- EVP/branch/leaf scope ถูกต้อง
- ระบบคำนวณ count ทุก hierarchy level และ Report แสดง resolved scope, Site counts และ file names จาก fixture
- Counts reconcile กับ distinct file rows
- Scope enforced ที่ server/data boundary
- UI อ่าน cached store เท่านั้น
- Schedule/partial/locked/error states demo ได้
- ไม่มี Graph app-only secret หรือ permission จริงใน browser
- มี review checkpoint ก่อน P4

### Production ยังไม่ถือว่าเสร็จจนกว่า

- P4/P5 ผ่านกับ tenant test site
- Graph permissions ผ่าน security review/admin consent
- Storage scale ผ่าน measurement
- Scheduled scans มี monitoring/alerts/recovery
- Export/audit/retention policy ได้รับอนุมัติ
- Customer UAT ผ่าน

## 18. Risks และคำถามที่ต้องยืนยัน

### Known risks

- Graph extraction ทำงานระดับไฟล์และอาจช้าเมื่อ baseline ใหญ่
- API รองรับเฉพาะ file extensions บางประเภท
- Locked/encrypted files อาจ extract ไม่ได้
- Graph throttling ต้องใช้ bounded concurrency และ retry
- File names ของ reportable Sensitive documents เป็น sensitive metadata
- Inventory รายไฟล์อาจใหญ่เกิน SharePoint List
- App-only scanner permissions อาจกว้างและต้อง customer approval
- Label display name อาจเปลี่ยน จึงต้องอิง label ID

### Open decisions

- ชื่อ hierarchy levels จริงของลูกค้า
- Business node ใด map กับ SharePoint Sites ใด และใครเป็นเจ้าของ mapping
- Reportable label IDs ที่ production ใช้ รวม Confidential และ Secret ตาม policy ลูกค้า
- Nightly schedule เวลาใดและ timezone ใด
- Weekly full reconciliation จำเป็นหรือไม่
- ใครมีสิทธิ์ export
- ใครมีสิทธิ์ Run now
- แสดง direct file URL หรือไม่
- Report metadata visibility ต้องสอดคล้องกับ SharePoint file access หรือเป็น executive governance scope แยก
- Expected number of sites, libraries และ files
- Inventory retention/history period
- Production storage choice
- Scanner credential model: certificate, managed identity หรือ secret ตาม customer constraints

## 19. Suggested New Repository Structure

โครงสร้างเริ่มต้นที่แนะนำ:

```text
sharepoint-sensitivity-report/
├── REQUIREMENTS.md
├── README.md
├── apps/
│   ├── report-web/
│   └── scanner-worker/
├── packages/
│   ├── domain/
│   ├── hierarchy/
│   ├── inventory/
│   ├── graph-client/
│   └── test-fixtures/
├── docs/
│   ├── architecture.md
│   ├── security.md
│   ├── data-model.md
│   └── prototype-progress.md
└── config/
    └── sample-hierarchy.json
```

ไม่จำเป็นต้องสร้างทุก package ตั้งแต่วันแรก แต่ต้องรักษา boundary ระหว่าง report web, scanner และ pure domain logic

## 20. New Thread Handoff Prompt

ใช้ข้อความนี้เริ่ม thread ใหม่ได้:

```text
อ่าน REQUIREMENTS.md ทั้งหมดก่อนเริ่มงาน เอกสารนี้เป็น source of truth สำหรับ repo ใหม่ SharePoint Sensitivity Label Report

เริ่มทำเฉพาะ Prototype P0-P3 ก่อน:
1. ตั้ง repository quality baseline
2. สร้าง hierarchy/domain model และ fixture tests
3. สร้าง report-only UI ที่แสดง Sensitive counts ทุกระดับ แยก filter ตาม label และ drill down ถึงชื่อไฟล์
4. สร้าง scanner/store contracts และจำลอง scheduled cached inventory

ข้อห้าม:
- ห้ามเชื่อม Microsoft Graph tenant จริงก่อน review checkpoint
- ห้ามใส่ scanner secret/app-only token ใน browser
- ห้ามพึ่ง client-side filtering เพื่อป้องกัน file names
- ห้ามแก้หรือผูก deployment กับ SharePoint Permission Management app เดิม

หลังแต่ละ stage ให้อัปเดต docs/prototype-progress.md และรายงาน lint/test/build ที่รัน
```

## 21. Official API Reference

- [Microsoft Graph: driveItem extractSensitivityLabels](https://learn.microsoft.com/en-us/graph/api/driveitem-extractsensitivitylabels?view=graph-rest-1.0)
- [Microsoft Graph throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)

## 22. Final Summary

ระบบใหม่คือ read-only governance report app สำหรับ sensitivity-label inventory แบบ hierarchy-scoped โดย business hierarchy และ flat SharePoint Site inventory เป็นคนละโมเดลและเชื่อมกันผ่าน explicit mapping ข้อมูลมาจาก scheduled cached scan ไม่ใช่ real time ผู้บริหารเห็นยอดรวมทุกระดับและ drill down ถึง Sites/ชื่อไฟล์ที่ mapping อนุญาต Configured reportable label IDs รองรับหลายระดับ เช่น Confidential และ Secret ขณะที่ scanner identity, report identity, storage และ deployment แยกจาก permission-management app เดิมอย่างชัดเจน
