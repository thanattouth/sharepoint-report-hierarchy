# คู่มือ Feature และการใช้งาน

เอกสารนี้อธิบาย SharePoint Sensitivity Label Report สำหรับผู้ใช้งานทั่วไป,
ReportAdmin และทีมที่ดูแลระบบ โดยอ้างอิง behavior ของ production application ปัจจุบัน

## 1. ระบบนี้ใช้ทำอะไร

ระบบเป็นศูนย์กลางแบบ read-only สำหรับดู SharePoint Sites และไฟล์ที่มี Microsoft Purview
Sensitivity Labels ภายในขอบเขตธุรกิจของผู้ใช้ เช่น `Confidential`, `Highly Confidential`
หรือ labels อื่นที่ลูกค้ากำหนดด้วย immutable label ID

ระบบช่วยตอบคำถามหลัก:

- ผู้ใช้คนนี้รับผิดชอบ business branch ใด
- ภายใต้ branch นั้นมี SharePoint Sites ใดบ้าง
- แต่ละ Site มี Sensitive files กี่ไฟล์
- ไฟล์อยู่ library/path ใดและติด label อะไร
- cached inventory ล่าสุดเมื่อใดและมี scan outcome ที่ต้องตรวจสอบหรือไม่

ระบบไม่เปลี่ยน SharePoint permission, ไม่ติดหรือถอด Sensitivity Label และไม่ scan แบบ real time
เมื่อเปิดหน้า Report

## 2. แนวคิดสิทธิ์ที่ต้องเข้าใจก่อน

ระบบแยกสิทธิ์เป็นสองส่วนและผู้ใช้ต้องผ่านทั้งสองส่วน

```text
Entra app role                      Business data scope
ReportViewer / ReportAdmin          Entra group -> business node -> descendant nodes -> mapped Sites
          \                         /
           +---- ต้องผ่านทั้งคู่ ---+
```

### 2.1 App role หรือ Capability

| App role | การใช้งาน |
| --- | --- |
| `ReportViewer` | เปิด Report และดูข้อมูลภายใน business scope ของตน |
| `ReportAdmin` | ดู Report และเปิดหน้า Business Scope/Site Mapping administration |

App role เพียงอย่างเดียวไม่ให้สิทธิ์เห็นทุก Site

### 2.2 Business data scope

Production ใช้ Entra security group เป็น membership source of truth แล้วผูก group เข้ากับ
business node ด้วย immutable Object ID

```text
EVP A
└── Department A
    └── Group A
        └── Project A
```

- Assignment ที่ `EVP A` และ `includeDescendants=true` เห็น Sites ที่ map อยู่กับทุก node ใต้
  EVP A
- Assignment ที่ Department หรือ Group เห็นเฉพาะ branch ของตน
- Assignment ที่ Project เห็นเฉพาะ Sites ที่ map กับ Project นั้น
- หลาย assignments รวม scope แบบไม่ซ้ำ
- EVP A ไม่เห็น EVP B โดยอัตโนมัติ
- Site ที่ scan แล้วแต่ยังไม่ map กับ business node จะไม่ปรากฏใน Report
- SharePoint Site Owner ไม่ได้ทำให้เกิด Report scope

## 3. การเข้าสู่ระบบ

1. เปิด Enterprise Application จาก Microsoft My Apps หรือ URL ของระบบ
2. Sign in ด้วยบัญชีใน Entra tenant ของลูกค้า
3. ระบบตรวจ tenant, app role, user Object ID และ group claims
4. ระบบ resolve business scope ก่อนอ่าน cached inventory

หาก group claim เกินขนาด token หรือยืนยัน scope ไม่ได้ ระบบจะ fail closed และไม่ส่ง aggregate,
file rows หรือ export

### Sign out

กด `Sign out` ที่มุมขวาบน ระบบจะล้าง application session, authorization-flow state และ
short-lived Graph token ของ Group Picker จากนั้นแสดงหน้า `SESSION CLEARED`

การ Sign out จาก application ไม่ใช่การ Sign out จาก Microsoft 365 ทั้ง tenant

## 4. หน้า Overview

หน้าแรกแสดงข้อมูลจาก scheduled cache เท่านั้น ประกอบด้วย:

- จำนวน Sensitive files ภายใน resolved scope
- จำนวน SharePoint Sites และ document libraries
- เวลาของ scheduled scan ล่าสุดและรอบถัดไป
- จำนวน outcomes ที่ต้องตรวจสอบ เช่น locked, throttled หรือ failed
- resolved-scope proof ว่าผู้ใช้ถูก assign ที่ node ใดและมองเห็นกี่ nodes/Sites

ตัวเลขบนหน้า Overview มาจาก Site summaries ที่ materialize ไว้ล่วงหน้า หน้าเว็บไม่ enumerate
ไฟล์จากทุก Site และไม่เรียก Microsoft Graph ตอนเปิดหน้า

## 5. Site Explorer

Site Explorer เป็น navigation หลักสำหรับผู้ใช้ทุกระดับ รองรับ tenant ที่มี Sites จำนวนมากโดยไม่
แสดง expanded hierarchy tree ทั้งหมด

ผู้ใช้สามารถ:

- ค้นหาด้วยชื่อ Site, Site ID หรือ business mapping
- กรองตาม business branch ที่อยู่ใน resolved scope
- ดูจำนวน Sensitive files ต่อ Site
- ดู business node ที่ Site ถูก map อยู่
- ดูเวลา scan ล่าสุดและสถานะ current, stale, attention หรือ awaiting scan
- paginate รายการ Sites

ผลการค้นหาและ Site rows มาจาก server-authorized rollups เท่านั้น การแก้ query string ไม่สามารถ
ขยาย scope ไปยัง branch หรือ Site อื่น

## 6. Site Detail และ Sensitive files

File-level inventory จะไม่ถูกโหลดจนกว่าผู้ใช้เลือก Site ที่ได้รับอนุญาต

หลังเลือก Site ระบบจะ:

1. ตรวจว่า Site ID อยู่ใน resolved scope
2. อ่าน Azure Table inventory partition ของ Site นั้นเท่านั้น
3. กรอง reportable label IDs และ filters ที่ server
4. ส่งเฉพาะ rows ของ Site ที่เลือกกลับมา

ข้อมูลในตารางประกอบด้วย:

- File name และ server-relative path
- Document library
- Sensitivity label และ assignment method เมื่อ Graph ส่งกลับ
- Scan status
- Last scanned และ modified time เมื่อมีข้อมูล
- Stable identity สำหรับ troubleshooting

### Filters ภายใน Site

- ค้นหาชื่อไฟล์หรือ path
- Document library
- Sensitivity label
- Scan status
- Freshness: current หรือ stale
- Server-side pagination

การกด `ล้าง` จะล้าง file filters แต่ยังอยู่ใน Site เดิม การกลับไป `All Sites` จะหยุดโหลด
file-level rows

### Open SharePoint

ปุ่ม `Open SharePoint ↗` เปิด canonical Site URL ใน tab ใหม่ URL สร้างจาก cached hostname/path
ที่ผ่าน SharePoint cloud allowlist

- Report ไม่ส่ง token ไปกับลิงก์
- Report ไม่เรียก Graph ตอนกด
- SharePoint authenticate และ enforce สิทธิ์ของผู้ใช้เอง
- การเห็น metadata ใน Report ไม่ได้แปลว่าผู้ใช้มีสิทธิ์เปิด Site หรือไฟล์ใน SharePoint

## 7. Cached scan และสถานะข้อมูล

Scheduled Scanner เป็น background workload แยกจาก Report Web

```text
Timer -> Queue -> one Site worker -> Microsoft Graph -> Azure Table cache -> Report API -> Web
```

- Timer ทำหน้าที่ enqueue เท่านั้น
- Queue worker หนึ่งงานรับผิดชอบหนึ่ง Site
- Site ถูก scan หนึ่งครั้งต่อรอบ ไม่ scan ซ้ำตามจำนวน EVP หรือผู้ใช้
- ใช้ delta/incremental processing หลัง baseline
- เขียน inventory ก่อนบันทึก delta cursor
- Materialize Site summary หลัง scan
- Retry แบบ bounded และ respect `Retry-After`
- ไม่ download เนื้อหาไฟล์

### Scan outcomes

| Outcome | ความหมาย |
| --- | --- |
| `success` | อ่าน label ได้สำเร็จ |
| `no-label` | อ่านได้แต่ไม่พบ label |
| `unsupported` | Graph endpoint ไม่รองรับไฟล์/สถานการณ์นั้น |
| `locked` | ไฟล์ถูก lock หรือ protection ทำให้ extract ไม่ได้ |
| `throttled` | Graph จำกัด request หลัง bounded retry |
| `failed` | เกิดข้อผิดพลาดอื่นที่เก็บเป็น item outcome |

Run ที่มี locked/unsupported/failed บางรายการอาจเป็น `partial` และต้องไม่ตีความว่า inventory ครบ

## 8. Business Scope Admin

หน้า `/admin/business-scope` ต้องใช้ verified Entra session ที่มี `ReportAdmin`

### 8.1 Business nodes

ReportAdmin สามารถสร้างหรือแก้ node ตาม chain:

```text
EVP -> Department -> Group -> Project
```

ทุก mutation ใช้ขั้นตอน Preview → Apply, expected version, Azure ETag และ append-only audit event
ระบบจะปฏิเสธ parent type ที่ผิด, cycle, missing parent และการ deactivate node ที่ยังมี child,
assignment หรือ Site placement ใช้งานอยู่

### 8.2 Scope assignments

ReportAdmin ผูก Entra User หรือ Group เข้ากับ business node ได้ โดย production แนะนำ Group
และ immutable Object ID

ค่าที่กำหนด:

- Principal type และ Object ID
- Display label สำหรับค้นหา/แสดงผล
- Target business node
- Business role metadata
- `includeDescendants`
- Active state

การเพิ่มหรือลบสมาชิกทำใน Entra group โดยไม่ต้องแก้ assignment ในระบบทุกครั้ง

### 8.3 Entra Group Picker

เมื่อ customer เปิด feature และให้ delegated admin consent `GroupMember.Read.All`, ReportAdmin
สามารถค้นหา security group ด้วยชื่อแทนการคัดลอก Object ID

- การค้นหาทำผ่าน server route
- Access token อยู่ใน encrypted HttpOnly cookie
- Browser ไม่ได้รับ Graph token
- หากปิด Group Picker assignments ที่บันทึกไว้ยังทำงานต่อ

## 9. Site Mapping Admin Inbox

หน้า `/admin/site-mappings` ต้องใช้ `ReportAdmin`

Inbox ช่วยจัดการ Sites ที่ scanner ค้นพบหรือ scan แล้วแต่ยังไม่มี business placement:

- แสดง unmapped Sites ก่อน
- ค้นหาและ paginate รายการ
- กรอง mapped/unmapped
- ดู hierarchy breadcrumb
- เลือกหลาย Sites เพื่อ map ไป node เดียวกัน
- Preview จำนวน new mappings, moves และ unchanged rows
- Apply ด้วย optimistic concurrency
- เก็บ actor, timestamp, version และ audit event

Site หนึ่งมี canonical active placement เดียว การย้าย Site คือการเปลี่ยน mapping ไม่ใช่การเพิ่ม
Site เป็น child ใน SharePoint hierarchy

## 10. Enterprise Application administration

ลูกค้าจัดการผู้ใช้ผ่าน Entra:

- เพิ่มผู้ดู Report เข้า group ที่ได้รับ `ReportViewer`
- เพิ่มผู้ดูแลเข้า group ที่ได้รับ `ReportAdmin`
- เพิ่ม/ลบสมาชิกจาก business scope groups
- เปิด `Assignment required` เพื่อป้องกันผู้ใช้ที่ไม่ได้ assign เข้า application

ชื่อ group เป็นค่าที่มนุษย์อ่านได้ใน delivery manifest แต่ระบบ resolve และ persist Object ID ของ
target tenant เท่านั้น ห้ามคัดลอก Object ID จาก tenant อื่น

## 11. Feature status ปัจจุบัน

| Feature | Production status |
| --- | --- |
| Entra single-tenant sign-in | เปิดใช้งาน |
| `ReportViewer` / `ReportAdmin` | เปิดใช้งาน |
| Group-based branch visibility | เปิดใช้งาน |
| Aggregate + Site Explorer | เปิดใช้งาน |
| Site-first Sensitive file detail | เปิดใช้งาน |
| Open SharePoint | เปิดใช้งาน |
| Business Scope Admin | เปิดใช้งานสำหรับ ReportAdmin |
| Site Mapping Inbox | เปิดใช้งานสำหรับ ReportAdmin |
| Entra Group Picker | เปิดตาม customer feature flag/consent |
| Scheduled Scanner | รองรับ แต่ initial delivery deploy timers เป็น disabled |
| Controlled baseline | เปิดผ่าน operator runbook หลัง approval |
| Export CSV ใน live Azure API mode | ยังปิด |
| Run now จาก production Web | ยังปิด; ใช้ protected operator endpoint/runbook |
| เปลี่ยน SharePoint permission หรือ Sensitivity Label | ไม่อยู่ใน scope |
| Direct file link | ยังไม่เปิด |

## 12. Empty, warning และ denied states

| State | ความหมาย/การแก้ไข |
| --- | --- |
| No active assignment | ผู้ใช้มี app role แต่ยังไม่มีกลุ่มที่ผูก business scope |
| No mapped Sites | มี node assignment แต่ยังไม่มี Site placement ใต้ branch |
| Awaiting baseline | Scope พร้อมแต่ Site ยังไม่มี completed scan |
| Zero Sensitive | Scan สำเร็จและไม่พบ configured reportable labels |
| Partial | รอบล่าสุดมี outcomes ที่ทำให้ข้อมูลอาจไม่ครบ |
| Stale | Cached inventory เกิน freshness threshold |
| Fail closed | อ่าน cache/identity/scope ไม่ได้ ระบบจึงไม่ส่งข้อมูล |
| Access denied | Tenant, app role หรือ request origin ไม่ผ่าน policy |

## 13. Security boundary โดยสรุป

- Report Web, Report API, Scanner และ Configuration Admin แยก workload identities
- Report reader มี Table Data Reader เท่านั้น
- Scanner มี Graph application permissions และ Table write เฉพาะ workload
- Configuration writer เขียนเฉพาะ configuration tables และอ่าน ScannerSites
- Function keys อยู่หลัง server bridge และ Key Vault
- Browser ไม่ได้รับ scanner credential, Function key, Storage token หรือ Graph app-only token
- File names, paths และ labels เป็น sensitive metadata และห้าม log โดยไม่จำเป็น
- ทุก scope ถูก resolve ก่อนอ่าน inventory
- Shared Key ถูกปิดและใช้ managed identity/RBAC

## 14. งานประจำของผู้ดูแล

### เมื่อมีผู้ใช้ใหม่

1. Assign ผู้ใช้หรือ group ให้ Enterprise Application
2. เพิ่มผู้ใช้เข้า business scope group ที่ถูกต้อง
3. ตรวจว่ากลุ่มนั้นมี active Scope Assignment
4. ให้ผู้ใช้ sign out/sign in ใหม่เพื่อรับ claims ล่าสุด

### เมื่อมี Site ใหม่

1. Discover/เพิ่ม Site เข้า ScannerSites แบบ scan disabled
2. Review document-library drive allowlist
3. ทำ controlled baseline
4. ตรวจ scan outcome และ Site summary
5. Map Site ไป business node ผ่าน Site Mapping Inbox
6. เปิด schedule เฉพาะหลังผ่าน approval gate

### เมื่อองค์กรเปลี่ยนโครงสร้าง

1. สร้าง/แก้ business nodes ด้วย Preview
2. ย้าย Site placements หรือ assignments ตามลำดับ
3. ตรวจ impact และ version conflict
4. Apply และตรวจ audit ledger
5. ทดสอบอย่างน้อย ReportViewer ของ branch ที่เปลี่ยนและ sibling denial

## 15. เอกสารที่เกี่ยวข้อง

- [Customer single-tenant delivery](customer-single-tenant-delivery.md)
- [Production readiness](production-readiness.md)
- [Scheduled scanner runbook](p5-scheduled-scanner-runbook.md)
- [Report Cache API](p6-report-cache-api.md)
- [Business scope configuration](p7-business-scope-configuration.md)
- [Entra web authorization](p8-entra-web-auth.md)
- [Azure App Service runbook](p8-azure-app-service.md)
