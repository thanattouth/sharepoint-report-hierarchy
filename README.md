# SharePoint Sensitivity Label Report

ระบบรายงานไฟล์ที่ติด Microsoft Purview Sensitivity Label ภายใต้ SharePoint
hierarchy scope ของผู้ใช้ รองรับ deterministic fixtures สำหรับ local verification และ
customer-owned single-tenant production deployment ที่แยก Scheduled Scanner, cache-only Report
API, Configuration Admin API และ Web App เป็นคนละ workload/managed identity ข้อมูล business
hierarchy, User/Group assignments และ canonical Site placements เก็บใน Azure Tables ส่วน Web ใช้
Entra OIDC + app roles ป้องกัน Report และ Administration UI/API

Business hierarchy เป็น forest ของหลาย EVP roots โดยแต่ละสายใช้โครงสร้าง
`EVP -> Department -> Group -> Project` ผู้ใช้ทุกระดับรวมถึง EVP เห็นเฉพาะ Sites
ที่มี active mapping อยู่ใน node/descendants ของตน ไม่ได้เห็นทั้ง tenant จาก role เพียงอย่างเดียว

## Local development

```bash
npm install
npm run dev
```

Local Azure/operator commands use scoped env profiles instead of one combined file. Start with
[docs/environment-profiles.md](docs/environment-profiles.md) and copy only the relevant
`.env.*.example` files. The old `.env.p4.local` is a filtered compatibility fallback only.

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
```

หน้า Report ใช้ cached store contracts เท่านั้นและไม่เรียก Microsoft Graph ตอนโหลดหน้า
P4 scanner boundary, environment contract และขั้นตอน approval อยู่ใน
`docs/p4-graph-pilot.md` ห้าม commit populated `.env` หรือ scanner credential

P5 Timer/Queue deployment, cross-tenant federation, bounded Run now proof และ recovery
อยู่ใน `docs/p5-scheduled-scanner-runbook.md` Timer ถูก deploy แบบ disabled จนกว่า
source-tenant admin consent และ manual proof จะผ่าน

P7 schema, migration, rollback และ admin-write boundary อยู่ใน
`docs/p7-business-scope-configuration.md` Report API มีสิทธิ์อ่านเท่านั้น ส่วน
Configuration Admin API เป็น service แยกและยังไม่เปิด browser write จนกว่าจะ provision
identity/RBAC และ authenticated administrator flow

Configuration Admin API pilot ถูก provision ด้วย writer identity ที่มีสิทธิ์เฉพาะ configuration
tables และ read-only `ScannerSites` แล้ว หน้า `/admin/site-mappings` และ API ทุก route ต้องมี
verified Entra session ที่มี `ReportAdmin` ก่อน Inbox/preview/Apply จะทำงาน Function key อยู่ฝั่ง
server และ audit actor มาจาก verified UPN ไม่ใช่ค่าจาก browser ดู provisioning, rotation และ
ขอบเขตที่ยังเหลือใน [docs/p8-entra-web-auth.md](docs/p8-entra-web-auth.md)

การติดตั้งแบบ customer-owned single tenant ใช้ validated delivery manifest, preflight, What-if และ
explicit RBAC/admin-consent gates ตาม
[docs/customer-single-tenant-delivery.md](docs/customer-single-tenant-delivery.md)

คู่มือความสามารถทั้งหมดและขั้นตอนใช้งานสำหรับ ReportViewer, ReportAdmin และทีม operation อยู่ที่
[docs/feature-guide.md](docs/feature-guide.md)
