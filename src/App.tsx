import React, { useState, useEffect, useMemo } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  getDocs,
  writeBatch,
  runTransaction, // <--- เพิ่มตัวนี้สำหรับลบแล้วคืนเลข
} from "firebase/firestore";

// Import jsPDF
import jsPDF from "jspdf";

// --- IMPORT ASSETS ---
import { fontSarabunBase64, formImageBase64 } from "./pdfAssets";

// Icons
import {
  Wrench,
  User,
  LogOut,
  X,
  Hammer,
  Trash2,
  UserPlus,
  Settings,
  Plus,
  Crown,
  ClipboardCheck,
  ListTodo,
  UserCog,
  UserCheck,
  CheckCircle2,
  History,
  Calendar,
  ChevronRight,
  Lock,
  CheckSquare,
  Square,
  MousePointer2,
  FileDown,
  Eye,
  Download,
  Pencil,
  Save,
  AlertCircle,
  Clock,
} from "lucide-react";

// ==========================================
// TELEGRAM CONFIG
// ==========================================
const TELEGRAM_TOKEN = "8479695961:AAFtKB3MuE1PHk9tYVckhgYPrbb2dYpI1eI";
const TELEGRAM_CHAT_ID = "-5081774286";

const sendTelegram = async (message: string) => {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("Telegram Network Error:", err);
  }
};

// ==========================================
// 1. TYPES & HELPERS
// ==========================================

type TicketStatus =
  | "Open"
  | "In_Progress"
  | "Waiting_Part"
  | "Wait_Leader"
  | "Wait_Verify"
  | "Wait_Approve"
  | "Closed";

interface MaintenanceTicket {
  id: string;
  machine_id: string;
  machine_name: string;
  job_type: string;
  department: string;
  factory: string;
  area: string;
  issue_item: string;
  issue_detail: string;
  status: TicketStatus;
  source: "Manual";
  requester: string;
  requester_fullname: string;
  requester_date: string;
  technician_id?: string;
  technician_name?: string;
  cause_detail?: string;
  solution?: string;
  prevention?: string;
  cause_category?: string;
  cause_category_other?: string;
  spare_parts?: { name: string; qty: number }[];
  maintenance_result?: string;
  maintenance_result_other?: string;
  result_remark?: string;
  delay_reason?: string;
  start_time?: any;
  end_time?: any;
  total_hours?: number;
  mc_status?: "Stop MC" | "Not Stop";
  leader_checked_by?: string;
  leader_checked_at?: any;
  verified_at?: any;
  approved_by?: string;
  approved_at?: any;
  closed_at?: any;
  images?: string[];
  image_url?: string;
  created_at: any;
  updated_at: any;
}

type UserRole =
  | "super_admin"
  | "supervisor"
  | "leader"
  | "technician"
  | "requester";

interface User {
  id?: string;
  username: string;
  pass: string;
  fullname?: string;
  role: UserRole;
}

const formatDate = (ts: any) => {
  if (!ts) return "-";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
};

const getStatusColor = (status: TicketStatus) => {
  switch (status) {
    case "Open":
      return "bg-red-500";
    case "In_Progress":
      return "bg-blue-500";
    case "Waiting_Part":
      return "bg-yellow-500";
    case "Wait_Leader":
      return "bg-indigo-500";
    case "Wait_Verify":
      return "bg-purple-500";
    case "Wait_Approve":
      return "bg-orange-500";
    case "Closed":
      return "bg-gray-500";
    default:
      return "bg-gray-500";
  }
};

const getStatusLabel = (status: TicketStatus) => {
  switch (status) {
    case "Open":
      return "รอรับงาน";
    case "In_Progress":
      return "กำลังซ่อม";
    case "Waiting_Part":
      return "รออะไหล่";
    case "Wait_Leader":
      return "รอหน.ช่าง";
    case "Wait_Verify":
      return "รอผู้แจ้ง";
    case "Wait_Approve":
      return "รออนุมัติ";
    case "Closed":
      return "ปิดงาน";
    default:
      return status;
  }
};

// Helper เช็ค 48 ชั่วโมง
const isOverdue48h = (createdAt: any) => {
  if (!createdAt) return false;
  const createdDate = createdAt.toDate
    ? createdAt.toDate()
    : new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - createdDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > 48;
};

// Helper คำนวณระยะเวลาจาก CreatedAt ถึงปัจจุบัน
const getElapsedTime = (createdAt: any) => {
  if (!createdAt) return "";
  const start = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${diffHrs} ชม. ${diffMins} นาที`;
};

// ==========================================
// 2. PDF GENERATOR FUNCTION (Fix Signatures Dates)
// ==========================================
const generateMaintenancePDF = (tickets: MaintenanceTicket[]) => {
  const formBase64 = formImageBase64;
  const fontBase64 = fontSarabunBase64;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Load Font
  if (fontBase64 && fontBase64.length > 100) {
    doc.addFileToVFS("THSarabunNew.ttf", fontBase64);
    doc.addFont("THSarabunNew.ttf", "THSarabun", "normal");
    doc.setFont("THSarabun");
  } else {
    doc.setFont("helvetica");
  }

  // Helper: จัดการวันที่ให้ปลอดภัย (รับทั้ง Timestamp และ Date)
  const fmtDate = (val: any) => {
    if (!val) return "";
    try {
      const d = val.toDate ? val.toDate() : new Date(val);
      return d.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      });
    } catch (e) {
      return "";
    }
  };

  // Helper: จัดการเวลา
  const fmtTime = (val: any) => {
    if (!val) return "";
    try {
      const d = val.toDate ? val.toDate() : new Date(val);
      const h = d.getHours().toString().padStart(2, "0");
      const m = d.getMinutes().toString().padStart(2, "0");
      return `${h}:${m} น.`;
    } catch (e) {
      return "";
    }
  };

  tickets.forEach((ticket, index) => {
    if (index > 0) doc.addPage();
    if (formBase64 && formBase64.length > 100)
      doc.addImage(formBase64, "JPEG", 0, 0, 210, 297);

    doc.setTextColor(0, 0, 255); // สีน้ำเงิน
    doc.setDrawColor(0, 0, 255);

    // Helper เขียนข้อความ
    const text = (
      str: string | undefined | null,
      x: number,
      y: number,
      size: number = 14,
      align: "left" | "center" = "left"
    ) => {
      doc.setFontSize(size);
      const val = str ? str.toString() : "";
      doc.text(val, x, y, { align });
    };

    // Helper เช็คถูก
    const check = (x: number, y: number, isChecked: boolean) => {
      if (isChecked) {
        doc.setFontSize(24);
        doc.text("/", x, y);
      }
    };

    // --- 1. Header ---
    text(ticket.id.substring(0, 12).toUpperCase(), 175, 24, 16, "center");

    // --- 2. Requestor Info ---
    const job = ticket.job_type || "";
    check(30.5, 43.2, job.includes("เครื่องจักร"));
    check(30.5, 48, job.includes("อุปกรณ์"));
    check(30.5, 53, job.includes("สาธารณูปโภค"));
    check(30.5, 58, job.includes("ปรับปรุง"));
    check(30.5, 63, job.includes("อื่นๆ"));
    if (job.includes("อื่นๆ")) {
      text(job.split("(")[1]?.replace(")", "") || "", 48, 62, 14);
    }

    text(ticket.requester_fullname, 133, 44, 14);
    text(ticket.department, 143, 49, 14);

    if (ticket.created_at) {
      text(fmtDate(ticket.created_at), 123, 54, 14);
      text(fmtTime(ticket.created_at), 172, 54, 14);
    }

    text(ticket.machine_name, 122, 59, 14);

    // --- 3. Location ---
    check(117, 73, ticket.factory === "SAL01");
    check(160.5, 73, ticket.factory === "SAL02");

    const area = ticket.area || "";
    check(117, 78, area.includes("สำนักงาน") || area.includes("HeadOffice"));
    check(117, 82.5, area.includes("อัดรีด") || area.includes("Extrusion"));
    check(117, 87.5, area.includes("ตัด") || area.includes("Cutting"));
    check(117, 92.5, area.includes("บด") || area.includes("Grinding"));

    check(160.5, 78, area.includes("Office-WH"));
    check(
      160.5,
      82.5,
      area.includes("คลังสินค้า") || area.includes("Warehouse")
    );
    check(160.5, 87.5, area.includes("Dock") || area.includes("loading"));

    const isOtherArea = area.includes("อื่นๆ") || area.includes("Other");
    check(117, 97.5, ticket.factory === "SAL01" && isOtherArea);
    check(160.5, 92.5, ticket.factory === "SAL02" && isOtherArea);

    if (isOtherArea) {
      const otherAreaText = area.split("(")[1]?.replace(")", "") || "";
      if (ticket.factory === "SAL01") {
        text(otherAreaText, 132.5, 97, 14);
      } else {
        text(otherAreaText, 175, 91.5, 14);
      }
    }

    text(ticket.issue_item, 15, 73.5, 14);
    if (ticket.issue_detail) text(ticket.issue_detail, 15, 80, 14);

    // --- 4. Cause & Solution ---
    const causeDetail = doc.splitTextToSize(ticket.cause_detail || "", 90);
    text(causeDetail, 15, 115, 14);

    const cc = ticket.cause_category || "";
    check(117, 114.5, cc.includes("Dirty") || cc.includes("สกปรก"));
    check(117, 119.5, cc.includes("Loosen") || cc.includes("หลวม"));
    check(117, 124.5, cc.includes("Broken") || cc.includes("แตกหัก"));
    check(117, 129, cc.includes("Defect") || cc.includes("บกพร่อง"));
    check(117, 134, cc.includes("Expired") || cc.includes("หมดอายุ"));
    check(117, 139, cc.includes("Person") || cc.includes("ผิดพลาด"));

    const isOtherCause = cc.includes("อื่นๆ") || cc.includes("Other");
    check(117, 144, isOtherCause);
    if (isOtherCause) {
      text(ticket.cause_category_other || "", 140, 143, 14);
    }

    const solution = doc.splitTextToSize(ticket.solution || "", 90);
    text(solution, 15, 158, 14);

    // --- 5. Spare Parts ---
    let partY = 158;
    if (ticket.spare_parts) {
      ticket.spare_parts.forEach((part, i) => {
        if (i > 7) return;
        text(part.name, 112, partY, 14);
        text(`${part.qty}`, 170, partY, 14, "center");
        partY += 5;
      });
    }

    const prevention = doc.splitTextToSize(ticket.prevention || "", 90);
    text(prevention, 15, 202, 14);

    // --- 6. Result ---
    const res = ticket.maintenance_result || "";
    const remarkToShow =
      ticket.result_remark || ticket.maintenance_result_other || "";

    const isCompleted = res.includes("สมบูรณ์") || res.includes("Completed");
    const isWaitPart = res.includes("รออะไหล่") || res.includes("Part");
    const isSupplier = res.includes("ภายนอก") || res.includes("Supplier");
    const isOtherResult = res.includes("อื่นๆ") || res.includes("Other");

    check(117, 201.5, isCompleted);
    check(117, 206.5, isWaitPart);
    check(117, 216.3, isSupplier);
    check(117, 226, isOtherResult);

    if (isWaitPart) {
      text(remarkToShow, 140, 206.5, 14);
    } else if (isSupplier) {
      text(remarkToShow, 140, 216, 14);
    } else if (isOtherResult) {
      text(ticket.maintenance_result_other || "", 140, 225.5, 14);
    }

    // --- MTTR ---
    if (ticket.start_time) {
      text(fmtDate(ticket.start_time), 35, 237, 14);
      text(fmtTime(ticket.start_time), 35, 242, 14);
    }
    if (ticket.end_time) {
      text(fmtDate(ticket.end_time), 90, 237, 14);
      text(fmtTime(ticket.end_time), 90, 242, 14);
    }
    if (ticket.total_hours) {
      const hrs = Math.floor(ticket.total_hours);
      const mins = Math.round((ticket.total_hours - hrs) * 60);
      text(`${hrs}`, 145, 242, 14, "center");
      text(`${mins}`, 175, 242, 14, "center");
    }

    check(51, 263.5, ticket.mc_status === "Stop MC");
    check(51, 268.2, ticket.mc_status === "Not Stop");

    // ==========================================
    // SIGNATURES & DATES (แก้ไขส่วนนี้)
    // ==========================================

    // 1. ช่องผู้ซ่อม (Technician) - ช่องซ้ายสุด
    if (ticket.technician_name) {
      text(ticket.technician_name, 41, 274, 14, "center");

      // ใช้วันที่ซ่อมเสร็จ (end_time) หรือวันที่ปัจจุบันถ้ายังไม่จบ
      const techDate = ticket.end_time || ticket.updated_at;
      if (techDate) {
        text(fmtDate(techDate), 41, 279, 14, "center");
      }
    }

    // 2. ช่องผู้ตรวจสอบ (Requester / Verify) - ช่องกลาง
    if (ticket.requester_fullname) {
      text(ticket.requester_fullname, 100, 274, 14, "center");

      // ใช้วันที่ Verified
      if (ticket.verified_at) {
        text(fmtDate(ticket.verified_at), 100, 279, 14, "center");
      }
    }

    // 3. ช่องผู้อนุมัติ (Approver / Closed) - ช่องขวาสุด
    const approverName =
      ticket.approved_by || (ticket.status === "Closed" ? "Auto Approved" : "");
    if (approverName) {
      text(approverName, 165, 274, 14, "center");

      // ใช้วันที่ Approved หรือ Closed
      const approvedDate = ticket.approved_at || ticket.closed_at;
      if (approvedDate) {
        text(fmtDate(approvedDate), 165, 279, 14, "center");
      }
    }
  });

  return doc;
};

// ==========================================
// 3. COMPONENTS (Preview & Confirm)
// ==========================================
function PDFPreviewModal({ isOpen, onClose, pdfUrl, onDownload }: any) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 z-[10000] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl h-[90vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        <div className="bg-gray-800 text-white px-4 py-3 flex justify-between items-center shrink-0">
          <h3 className="font-bold flex gap-2">
            <FileDown size={20} /> Preview
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-full"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 bg-gray-100 p-2 overflow-hidden">
          <iframe src={pdfUrl} className="w-full h-full rounded-lg border" />
        </div>
        <div className="p-4 bg-white border-t flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl text-gray-600 font-bold hover:bg-gray-100"
          >
            ยกเลิก
          </button>
          <button
            onClick={onDownload}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 flex gap-2"
          >
            <Download size={20} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmPasswordModal({
  isOpen,
  onClose,
  onConfirm,
  userPass,
  message,
}: any) {
  const [inputPass, setInputPass] = useState("");
  const [error, setError] = useState(false);
  if (!isOpen) return null;
  const handleSubmit = () => {
    if (inputPass === userPass) {
      onConfirm();
      onClose();
      setInputPass("");
      setError(false);
    } else setError(true);
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-[11000] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xs rounded-2xl p-6 shadow-2xl text-center">
        <div className="bg-red-100 p-3 rounded-full mb-3 inline-block">
          <Lock className="text-red-600" size={24} />
        </div>
        <h3 className="text-lg font-bold">ยืนยันรหัสผ่าน</h3>
        <p className="text-xs text-gray-500 mt-1">{message}</p>
        <input
          type="password"
          className={`w-full text-center border-2 rounded-xl p-2 text-lg my-2 outline-none ${
            error ? "border-red-500" : "border-gray-200"
          }`}
          placeholder="รหัสผ่าน"
          value={inputPass}
          onChange={(e) => {
            setInputPass(e.target.value);
            setError(false);
          }}
          autoFocus
        />
        {error && (
          <p className="text-xs text-red-500 mb-3">รหัสผ่านไม่ถูกต้อง!</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => {
              onClose();
              setInputPass("");
            }}
            className="flex-1 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-xl"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-2 bg-red-600 text-white font-bold text-sm rounded-xl hover:bg-red-700"
          >
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 4. LOGIN & TICKET CARD
// ==========================================
function LoginPage({ onLogin }: { onLogin: (u: User) => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [loading, setLoading] = useState(false);
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (u === "Bank" && p === "1439") {
      onLogin({
        username: "Bank",
        pass: "1439",
        role: "super_admin",
        fullname: "Bank (Owner)",
      });
      return;
    }
    try {
      const q = query(
        collection(db, "users_maintenance"),
        where("username", "==", u),
        where("pass", "==", p)
      );
      const snap = await getDocs(q);
      if (!snap.empty)
        onLogin({ ...snap.docs[0].data(), id: snap.docs[0].id } as User);
      else alert("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    } catch (err) {
      alert("Login Error: " + err);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-orange-500"></div>
        <div className="flex justify-center mb-6">
          <div className="bg-orange-100 p-4 rounded-full ring-4 ring-orange-50">
            <Wrench size={48} className="text-orange-600" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-center mb-1 text-gray-800">
          Maintenance App
        </h1>
        <form onSubmit={handleLogin} className="space-y-4 mt-8">
          <input
            className="w-full px-4 py-3 border rounded-xl bg-gray-50 focus:bg-white outline-none"
            placeholder="Username"
            value={u}
            onChange={(e) => setU(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            className="w-full px-4 py-3 border rounded-xl bg-gray-50 focus:bg-white outline-none"
            placeholder="Password"
            value={p}
            onChange={(e) => setP(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 text-white p-4 rounded-xl font-bold text-lg hover:bg-orange-700 shadow-lg transition-all disabled:bg-gray-400"
          >
            {loading ? "Loading..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  onClick,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
}: any) {
  const handleCardClick = () => {
    if (isSelectionMode && onToggleSelect) onToggleSelect(ticket.id);
    else onClick();
  };
  const formatDateTimeTH = (timestamp: any) => {
    if (!timestamp) return "-";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const isOverdue =
    isOverdue48h(ticket.created_at) && ticket.status === "In_Progress";

  return (
    <div
      onClick={handleCardClick}
      className={`px-3 py-2.5 rounded-lg shadow-sm border transition-all active:scale-[0.99] cursor-pointer flex items-center justify-between gap-3 ${
        isSelectionMode && isSelected
          ? "border-orange-500 bg-orange-50 ring-1 ring-orange-500"
          : isOverdue
          ? "border-red-500 bg-red-50"
          : "border-gray-200 bg-white hover:border-orange-300"
      }`}
    >
      {isSelectionMode && (
        <div className="shrink-0 text-orange-600">
          {isSelected ? (
            <CheckSquare size={20} className="fill-orange-100" />
          ) : (
            <Square size={20} className="text-gray-300" />
          )}
        </div>
      )}
      <div className="flex items-center gap-3 overflow-hidden flex-1">
        <div
          className={`w-2.5 h-2.5 shrink-0 rounded-full ${getStatusColor(
            ticket.status
          )} shadow-sm`}
          title={getStatusLabel(ticket.status)}
        ></div>
        <div className="flex flex-col overflow-hidden w-full">
          <div className="flex items-center text-sm text-gray-800 truncate w-full">
            <span className="font-bold shrink-0">{ticket.machine_name}</span>
            <span className="mx-1.5 text-gray-300">|</span>
            <span className="text-gray-600 truncate">{ticket.issue_item}</span>
          </div>
          <div className="text-[10px] text-gray-500 flex items-center gap-2 mt-1 w-full overflow-hidden">
            {ticket.department && (
              <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-semibold shrink-0">
                {ticket.department}
              </span>
            )}
            <span className="flex items-center gap-1 shrink-0 truncate">
              <User size={10} />{" "}
              {(ticket.requester_fullname || "").split(" ")[0]}
            </span>
            <span className="text-gray-300 shrink-0">|</span>
            <span
              className={`${
                isOverdue ? "text-red-600 font-bold" : "text-gray-400"
              } shrink-0 tabular-nums`}
            >
              {formatDateTimeTH(ticket.created_at)}
              {/* --- แสดงเลขที่ใบงานต่อท้ายเวลา --- */}
              <span className="font-mono font-bold text-gray-400 ml-1">
                (#{ticket.id})
              </span>
            </span>
          </div>
        </div>
      </div>
      {!isSelectionMode && (
        <ChevronRight size={16} className="text-gray-300 shrink-0" />
      )}
    </div>
  );
}

// ==========================================
// 6. TICKET DETAIL MODAL (Final: Orange Theme for Disabled Inputs)
// ==========================================
function TicketDetailModal({
  ticket,
  user,
  onClose,
  onDelete,
}: {
  ticket: MaintenanceTicket;
  user: User;
  onClose: () => void;
  onDelete: (id: string, status: string) => void;
}) {
  const [causeDetail, setCauseDetail] = useState(ticket.cause_detail || "");
  const [solution, setSolution] = useState(ticket.solution || "");
  const [prevention, setPrevention] = useState(ticket.prevention || "");
  const [causeCategory, setCauseCategory] = useState(
    ticket.cause_category || ""
  );
  const [causeCategoryOther, setCauseCategoryOther] = useState(
    ticket.cause_category_other || ""
  );
  const [maintenanceResult, setMaintenanceResult] = useState(
    ticket.maintenance_result || ""
  );
  const [maintenanceResultOther, setMaintenanceResultOther] = useState(
    ticket.maintenance_result_other || ""
  );
  const [resultRemark, setResultRemark] = useState(ticket.result_remark || "");
  const [delayReason, setDelayReason] = useState(ticket.delay_reason || "");
  const [spareParts, setSpareParts] = useState<{ name: string; qty: string }[]>(
    ticket.spare_parts
      ? ticket.spare_parts.map((p) => ({
          name: p.name,
          qty: p.qty.toString(),
        }))
      : []
  );
  const [mcStatus, setMcStatus] = useState<"Stop MC" | "Not Stop">(
    ticket.mc_status || "Not Stop"
  );
  const [startTime, setStartTime] = useState(
    ticket.start_time
      ? new Date(ticket.start_time.toDate()).toISOString().slice(0, 16)
      : ""
  );
  const [endTime, setEndTime] = useState(
    ticket.end_time
      ? new Date(ticket.end_time.toDate()).toISOString().slice(0, 16)
      : ""
  );

  const [isEditingId, setIsEditingId] = useState(false);
  const [newTicketId, setNewTicketId] = useState(ticket.id);

  const [causeOptions, setCauseOptions] = useState<string[]>([]);
  const [resultOptions, setResultOptions] = useState<string[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const fetchOpts = async () => {
      const c = await getDoc(
        doc(db, "maintenance_settings", "cause_categories")
      );
      const r = await getDoc(
        doc(db, "maintenance_settings", "maintenance_results")
      );
      setCauseOptions(c.exists() ? c.data().list : []);
      setResultOptions(r.exists() ? r.data().list : []);
    };
    fetchOpts();
  }, []);

  const calculateDuration = () => {
    if (!startTime || !endTime) return "-";
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (end < start) return "-";
    const diff = end - start;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours} ชม. ${minutes} นาที`;
  };
  const calculateHoursDecimal = () => {
    if (!startTime || !endTime) return 0;
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (end < start) return 0;
    return parseFloat(((end - start) / (1000 * 60 * 60)).toFixed(2));
  };
  const formatRequestTime = (ts: any) => {
    if (!ts) return "-";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isSuperAdmin = user.role === "super_admin" || user.username === "Bank";
  const isSupervisor = user.role === "supervisor" || isSuperAdmin;
  const isLeader = user.role === "leader" || isSuperAdmin;
  const isTechnician = user.role === "technician" || isLeader;
  const isRequester =
    user.role === "requester" ||
    user.username === ticket.requester ||
    isSuperAdmin;

  const handleAddPart = () =>
    setSpareParts([...spareParts, { name: "", qty: "" }]);
  const handleRemovePart = (idx: number) =>
    setSpareParts(spareParts.filter((_, i) => i !== idx));
  const handlePartChange = (
    idx: number,
    field: "name" | "qty",
    val: string
  ) => {
    const newParts = [...spareParts];
    newParts[idx][field] = val;
    setSpareParts(newParts);
  };

  const isActuallyOverdue = isOverdue48h(ticket.created_at);
  const isOverdue = isActuallyOverdue && ticket.status === "In_Progress";
  const isEditable =
    (isTechnician && ticket.status === "In_Progress") ||
    (isSuperAdmin &&
      (ticket.status === "Wait_Approve" || ticket.status === "Closed"));
  const isWorkCompleted =
    maintenanceResult.includes("สมบูรณ์") ||
    maintenanceResult.includes("Completed") ||
    maintenanceResult.includes("Complete") ||
    maintenanceResult.includes("เรียบร้อย");
  const showRemarkInput = maintenanceResult && !isWorkCompleted;
  const canEditTicketId =
    (isSuperAdmin || isSupervisor) &&
    (ticket.status === "Closed" || ticket.status === "Wait_Approve");

  const handleUpdateTicketId = async () => {
    if (!newTicketId.trim() || newTicketId === ticket.id) {
      setIsEditingId(false);
      return;
    }
    if (
      !confirm(
        `ยืนยันการเปลี่ยนเลขที่ใบงานจาก ${ticket.id} เป็น ${newTicketId} ?`
      )
    )
      return;
    try {
      setIsUpdating(true);
      const newDocRef = doc(db, "maintenance_tickets", newTicketId);
      const newDocSnap = await getDoc(newDocRef);
      if (newDocSnap.exists()) {
        alert(`เลขที่ ${newTicketId} มีอยู่แล้ว!`);
        setIsUpdating(false);
        return;
      }

      const { id, ...currentData } = ticket;
      const updatedData = {
        ...currentData,
        cause_detail: causeDetail,
        solution: solution,
        maintenance_result: maintenanceResult,
        result_remark: resultRemark,
        delay_reason: delayReason,
        spare_parts: spareParts,
        updated_at: serverTimestamp(),
      };

      await setDoc(newDocRef, updatedData);
      await deleteDoc(doc(db, "maintenance_tickets", ticket.id));
      alert("เปลี่ยนเลขที่เรียบร้อย");
      onClose();
    } catch (error) {
      alert("Error: " + error);
    } finally {
      setIsUpdating(false);
    }
  };

  const updateStatus = async (action: string) => {
    if (
      !confirm(
        action === "AdminSave" ? "ยืนยันการบันทึก?" : `ยืนยันการทำรายการ?`
      )
    )
      return;
    setIsUpdating(true);
    try {
      const updateData: any = { updated_at: serverTimestamp() };
      if (action === "AdminSave" || action !== "Start") {
        updateData.cause_detail = causeDetail;
        updateData.solution = solution;
        updateData.prevention = prevention;
        updateData.cause_category = causeCategory;
        updateData.cause_category_other =
          causeCategory === "อื่นๆ" ? causeCategoryOther : "";
        updateData.maintenance_result = maintenanceResult;
        updateData.maintenance_result_other =
          maintenanceResult === "อื่นๆ" ? maintenanceResultOther : "";
        updateData.result_remark = resultRemark;
        updateData.delay_reason = delayReason;
        updateData.mc_status = mcStatus;
        updateData.spare_parts = spareParts
          .filter((p) => p.name)
          .map((p) => ({ name: p.name, qty: parseFloat(p.qty) || 0 }));
        if (startTime)
          updateData.start_time = Timestamp.fromDate(new Date(startTime));
        if (endTime)
          updateData.end_time = Timestamp.fromDate(new Date(endTime));
        updateData.total_hours = calculateHoursDecimal();
      }
      if (action === "Start") {
        updateData.status = "In_Progress";
        updateData.technician_id = user.username;
        updateData.technician_name = user.fullname || user.username;
        updateData.start_time = serverTimestamp();
        setStartTime(new Date().toISOString().slice(0, 16));
      }
      if (action === "ToVerify") {
        if (
          !causeDetail ||
          !solution ||
          !causeCategory ||
          !maintenanceResult ||
          !startTime ||
          !endTime
        ) {
          alert("กรุณากรอกข้อมูลให้ครบ");
          setIsUpdating(false);
          return;
        }
        if (isActuallyOverdue && !delayReason.trim()) {
          alert("เกิน 48 ชม. ต้องระบุเหตุผลความล่าช้า");
          setIsUpdating(false);
          return;
        }
        updateData.status = "Wait_Verify";
      }
      if (action === "UserConfirm") {
        updateData.status = "Wait_Approve";
        updateData.verified_at = serverTimestamp();
        updateData.verified_by = user.fullname || user.username;
      }
      if (action === "ToApprove") {
        updateData.status = "Wait_Approve";
      }
      if (action === "Close") {
        updateData.status = "Closed";
        updateData.approved_by = user.fullname || user.username;
        updateData.approved_at = serverTimestamp();
        updateData.closed_at = serverTimestamp();
      }

      await updateDoc(doc(db, "maintenance_tickets", ticket.id), updateData);
      if (action === "AdminSave") alert("บันทึกเรียบร้อย");
      else onClose();
    } catch (err) {
      alert("Error: " + err);
    } finally {
      setIsUpdating(false);
    }
  };

  // --- STYLES (แก้ไขตรงนี้ให้เป็นสีส้ม) ---
  const labelClass = "text-[10px] font-bold text-black mb-1 block";

  // แก้ disabled:bg-gray-100 -> disabled:bg-orange-50 และ disabled:border-orange-200
  const inputClass =
    "w-full border border-gray-300 rounded-lg px-3 py-1.5 text-base text-gray-900 h-10 focus:bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors bg-white disabled:bg-orange-50 disabled:text-gray-700 disabled:border-orange-200";

  // แก้ bg-gray-100 -> bg-orange-50 และ border-gray-200 -> border-orange-200
  const displayBoxClass =
    "w-full border border-orange-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 h-10 flex items-center bg-orange-50";

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-4xl h-[95vh] sm:h-auto sm:max-h-[95vh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="bg-white px-4 py-3 border-b flex justify-between items-center sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="bg-gray-100 p-2 rounded-full">
              <ClipboardCheck size={20} className="text-gray-600" />
            </div>
            <div className="flex flex-col">
              <h2 className="text-lg font-bold text-gray-800 leading-none flex items-center gap-2">
                รายละเอียดใบงาน
              </h2>
              <div className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                {isEditingId ? (
                  <div className="flex items-center gap-1 animate-in fade-in zoom-in duration-200">
                    <input
                      value={newTicketId}
                      onChange={(e) => setNewTicketId(e.target.value)}
                      className="border border-blue-400 rounded px-2 py-0.5 text-sm font-bold text-blue-700 w-32 focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={handleUpdateTicketId}
                      className="bg-green-500 text-white p-1 rounded hover:bg-green-600"
                    >
                      <Save size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setIsEditingId(false);
                        setNewTicketId(ticket.id);
                      }}
                      className="bg-gray-300 text-gray-600 p-1 rounded hover:bg-gray-400"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    {(ticket.status !== "Open" || isSuperAdmin) && (
                      <span className="font-mono text-base font-normal">
                        #{ticket.id}
                      </span>
                    )}
                    {canEditTicketId && !isEditingId && (
                      <button
                        onClick={() => setIsEditingId(true)}
                        className="text-gray-400 hover:text-blue-500 transition-colors"
                        title="แก้ไขเลขที่"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors text-gray-500"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar bg-white pb-6">
          {ticket.status !== "Open" ? (
            <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
                <span className="font-bold text-gray-700 text-sm">
                  บันทึกการซ่อม (Maintenance Record)
                </span>
                <div className="flex items-center gap-1 text-[10px] text-gray-500 bg-white px-2 py-1 rounded-full border border-gray-200">
                  <Clock size={12} />
                  {formatRequestTime(ticket.created_at)}
                  <span className="font-mono text-gray-400 ml-1">
                    (#{ticket.id})
                  </span>
                </div>
              </div>
              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <label className={labelClass}>เครื่องจักร (Machine)</label>
                  <div className={displayBoxClass}>{ticket.machine_name}</div>
                </div>
                <div>
                  <label className={labelClass}>ปัญหา (Problem)</label>
                  <div className={displayBoxClass}>{ticket.issue_item}</div>
                </div>
                <div>
                  <label className={labelClass}>1. สาเหตุ (Cause)</label>
                  <input
                    className={inputClass}
                    value={causeDetail}
                    onChange={(e) => setCauseDetail(e.target.value)}
                    disabled={!isEditable}
                    placeholder="ระบุสาเหตุ..."
                  />
                </div>
                <div>
                  <label className={labelClass}>2. การแก้ไข (Correction)</label>
                  <input
                    className={inputClass}
                    value={solution}
                    onChange={(e) => setSolution(e.target.value)}
                    disabled={!isEditable}
                    placeholder="ระบุวิธีแก้ไข..."
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    3. การป้องกัน (Prevention)
                  </label>
                  <input
                    className={inputClass}
                    value={prevention}
                    onChange={(e) => setPrevention(e.target.value)}
                    disabled={!isEditable}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    4. ประเภทสาเหตุ (Category)
                  </label>
                  <div className="flex gap-2">
                    <select
                      className={`${inputClass} ${
                        !isEditable ? "bg-orange-50" : "bg-white"
                      }`}
                      value={causeCategory}
                      onChange={(e) => setCauseCategory(e.target.value)}
                      disabled={!isEditable}
                    >
                      <option value="">-- เลือก --</option>
                      {causeOptions.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                      <option value="อื่นๆ">อื่นๆ</option>
                    </select>
                    {causeCategory === "อื่นๆ" && (
                      <input
                        className={`${inputClass} bg-yellow-50`}
                        placeholder="ระบุ..."
                        value={causeCategoryOther}
                        onChange={(e) => setCauseCategoryOther(e.target.value)}
                        disabled={!isEditable}
                      />
                    )}
                  </div>
                </div>

                <div className="col-span-1">
                  <label className={labelClass}>5. อะไหล่ (Spare Parts)</label>
                  <div
                    className={`w-full border border-gray-300 rounded-lg px-3 py-1.5 min-h-[40px] flex flex-col justify-center relative ${
                      !isEditable
                        ? "bg-orange-50 border-orange-200"
                        : "bg-white"
                    }`}
                  >
                    {isEditable && (
                      <button
                        onClick={handleAddPart}
                        className="absolute top-1 right-1 p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                        title="เพิ่มอะไหล่"
                      >
                        <Plus size={16} />
                      </button>
                    )}
                    {spareParts.length === 0 ? (
                      <div className="text-sm text-gray-300 text-center italic pr-6">
                        - ไม่มีอะไหล่ -
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 pr-6">
                        {spareParts.map((part, idx) => (
                          <div key={idx} className="flex gap-1 items-center">
                            <input
                              className={`flex-1 border border-gray-300 rounded px-2 py-1 text-xs h-7 focus:bg-white outline-none disabled:bg-orange-50 disabled:border-orange-200 ${
                                !isEditable ? "bg-orange-50" : "bg-white"
                              }`}
                              placeholder="ชื่ออะไหล่"
                              value={part.name}
                              onChange={(e) =>
                                handlePartChange(idx, "name", e.target.value)
                              }
                              disabled={!isEditable}
                            />
                            <input
                              className={`w-12 border border-gray-300 rounded px-1 py-1 text-xs text-center h-7 focus:bg-white outline-none disabled:bg-orange-50 disabled:border-orange-200 ${
                                !isEditable ? "bg-orange-50" : "bg-white"
                              }`}
                              type="number"
                              placeholder="#"
                              value={part.qty}
                              onChange={(e) =>
                                handlePartChange(idx, "qty", e.target.value)
                              }
                              disabled={!isEditable}
                            />
                            {isEditable && (
                              <button
                                onClick={() => handleRemovePart(idx)}
                                className="text-gray-400 hover:text-red-500 px-1"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-span-1 flex flex-col gap-3">
                  <div>
                    <label className={labelClass}>6. ผลการซ่อม (Result)</label>
                    <select
                      className={`${inputClass} ${
                        !isEditable ? "bg-orange-50" : "bg-white"
                      }`}
                      value={maintenanceResult}
                      onChange={(e) => setMaintenanceResult(e.target.value)}
                      disabled={!isEditable}
                    >
                      <option value="">-- เลือก --</option>
                      {resultOptions.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                      <option value="อื่นๆ">อื่นๆ</option>
                    </select>
                  </div>
                  {showRemarkInput && (
                    <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                      <label className={labelClass}>หมายเหตุ (Remark)</label>
                      <input
                        className={inputClass}
                        placeholder="ระบุรายละเอียด..."
                        value={
                          maintenanceResult === "อื่นๆ"
                            ? maintenanceResultOther
                            : resultRemark
                        }
                        onChange={(e) =>
                          maintenanceResult === "อื่นๆ"
                            ? setMaintenanceResultOther(e.target.value)
                            : setResultRemark(e.target.value)
                        }
                        disabled={!isEditable}
                      />
                    </div>
                  )}
                </div>

                <div className="col-span-1">
                  <label
                    className={`${labelClass} ${
                      isActuallyOverdue ? "text-red-600" : "text-gray-500"
                    } flex items-center gap-1`}
                  >
                    {isActuallyOverdue && <AlertCircle size={12} />}{" "}
                    เหตุผลความล่าช้า{" "}
                    <span
                      className={`${
                        isActuallyOverdue
                          ? "text-red-800 bg-red-100"
                          : "text-gray-600 bg-gray-100"
                      } font-bold px-1 rounded ml-1`}
                    >
                      {getElapsedTime(ticket.created_at)}
                    </span>
                  </label>
                  <input
                    className={`${inputClass} ${
                      isActuallyOverdue && isEditable && !delayReason
                        ? "border-red-500 bg-red-50"
                        : ""
                    } ${
                      !isActuallyOverdue || !isEditable
                        ? "bg-orange-50 text-gray-400"
                        : ""
                    }`}
                    placeholder={
                      isActuallyOverdue
                        ? "ระบุเหตุผล (จำเป็น)..."
                        : "ไม่เกินกำหนด (ล็อค)"
                    }
                    value={delayReason}
                    onChange={(e) => setDelayReason(e.target.value)}
                    disabled={!isActuallyOverdue || !isEditable}
                  />
                </div>

                <div className="col-span-1">
                  <label className={labelClass}>
                    ช่างผู้ปฏิบัติงาน (Technician)
                  </label>
                  <div className={displayBoxClass}>
                    <UserCog size={16} className="mr-2 text-gray-500" />
                    {ticket.technician_name || "- ยังไม่ระบุ -"}
                  </div>
                </div>

                <div className="col-span-1 md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                  <div>
                    <label className={labelClass}>
                      วันที่เริ่ม (Start Date)
                    </label>
                    <input
                      type="datetime-local"
                      className={`${inputClass} ${
                        !isEditable ? "bg-orange-50" : "bg-white"
                      }`}
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      disabled={!isEditable}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      วันที่เสร็จ (Finish Date)
                    </label>
                    <input
                      type="datetime-local"
                      className={`${inputClass} ${
                        !isEditable ? "bg-orange-50" : "bg-white"
                      }`}
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      disabled={!isEditable}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>เวลารวม / สถานะ</label>
                    <div className="flex gap-2">
                      <div className="flex-1 border border-orange-200 rounded-lg flex items-center justify-center text-sm font-bold text-gray-700 bg-orange-50 h-10">
                        {calculateDuration()}
                      </div>
                      <select
                        className={`flex-1 border border-gray-300 rounded-lg px-1 text-sm text-gray-900 focus:bg-white outline-none h-10 disabled:opacity-100 disabled:text-gray-900 ${
                          !isEditable
                            ? "bg-orange-50 disabled:border-orange-200"
                            : "bg-white"
                        }`}
                        value={mcStatus}
                        onChange={(e) => setMcStatus(e.target.value as any)}
                        disabled={!isEditable}
                      >
                        <option value="Not Stop">Not Stop</option>
                        <option value="Stop MC">Stop MC</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="col-span-1 md:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className={labelClass}>ประเภท (Type)</label>
                    <div className={displayBoxClass}>{ticket.job_type}</div>
                  </div>
                  <div>
                    <label className={labelClass}>สถานที่ (Location)</label>
                    <div className={displayBoxClass}>
                      {ticket.factory} - {ticket.area}
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>ผู้แจ้ง (Requester)</label>
                    <div className={displayBoxClass}>
                      {ticket.requester_fullname}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div className="flex justify-between items-center border-b pb-2 mb-3">
                  <h3 className="font-bold text-gray-700 flex items-center gap-2">
                    <ClipboardCheck size={18} /> รายละเอียดการแจ้งซ่อม
                  </h3>
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-50 px-2 py-1 rounded-full border border-gray-200">
                    <Clock size={12} />
                    {formatRequestTime(ticket.created_at)}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-bold text-gray-500 block mb-1">
                        เครื่องจักร (Machine)
                      </span>
                      <div className="text-sm font-semibold text-gray-800 bg-orange-50 p-2 rounded border border-orange-200 min-h-[38px] flex items-center">
                        {ticket.machine_name}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-500 block mb-1">
                        ปัญหา (Problem)
                      </span>
                      <div className="text-sm font-semibold text-gray-800 bg-orange-50 p-2 rounded border border-orange-200 min-h-[38px] flex items-center">
                        {ticket.issue_item}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-500 block mb-1">
                        สถานที่ (Location)
                      </span>
                      <div className="text-sm font-semibold text-gray-800 bg-orange-50 p-2 rounded border border-orange-200 min-h-[38px] flex items-center">
                        {ticket.factory} - {ticket.area}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-500 block mb-1">
                        แผนก (Department)
                      </span>
                      <div className="text-sm font-semibold text-gray-800 bg-orange-50 p-2 rounded border border-orange-200 min-h-[38px] flex items-center">
                        {ticket.department}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-500 block mb-1">
                        ผู้แจ้ง (Requester)
                      </span>
                      <div className="text-sm font-semibold text-gray-800 bg-orange-50 p-2 rounded border border-orange-200 min-h-[38px] flex items-center">
                        {ticket.requester_fullname}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-500 block mb-1">
                        เลขที่ใบงาน (Ticket ID)
                      </span>
                      <div className="text-sm font-semibold text-gray-600 bg-orange-50 p-2 rounded border border-orange-200 min-h-[38px] flex items-center font-mono">
                        #{ticket.id}
                      </div>
                    </div>
                  </div>
                  {ticket.image_url && (
                    <div className="mt-4 pt-3 border-t border-gray-100">
                      <span className="text-[10px] font-bold text-gray-500 block mb-2">
                        รูปภาพประกอบ
                      </span>
                      <div className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                        <img
                          src={ticket.image_url}
                          alt="Problem"
                          className="w-full h-auto max-h-60 object-contain"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3 pt-4 border-t border-gray-100">
            {ticket.status === "Open" && isTechnician && (
              <button
                onClick={() => updateStatus("Start")}
                className="w-full h-10 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <Wrench size={16} /> รับงานซ่อม (Start Job)
              </button>
            )}
            {ticket.status === "In_Progress" && isTechnician && (
              <button
                onClick={() => updateStatus("ToVerify")}
                className="w-full h-10 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <CheckCircle2 size={16} /> ซ่อมเรียบร้อย
              </button>
            )}
            {ticket.status === "Wait_Verify" && (
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 text-center">
                <p className="text-purple-900 font-semibold mb-3 text-sm">
                  สถานะ: รอผู้แจ้งตรวจรับงาน
                </p>
                {isRequester && (
                  <button
                    onClick={() => updateStatus("UserConfirm")}
                    className="w-full h-10 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <UserCheck size={16} /> ตรวจรับงาน (Confirm)
                  </button>
                )}
              </div>
            )}
            {ticket.status === "Wait_Approve" && (
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 text-center">
                <p className="text-orange-900 font-semibold mb-3 text-sm">
                  สถานะ: รอ Approval
                </p>
                {isSupervisor && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateStatus("Close")}
                      className="flex-1 h-10 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Crown size={16} /> Approve
                    </button>
                    {isSuperAdmin && (
                      <button
                        onClick={() => updateStatus("AdminSave")}
                        className="flex-1 h-10 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-all flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Settings size={16} /> บันทึกการแก้ไข
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {ticket.status === "Closed" && (
              <div className="space-y-3">
                <div className="w-full h-10 bg-gray-100 text-gray-500 text-sm font-bold flex items-center justify-center rounded-lg border border-gray-200">
                  <Lock size={14} className="mr-2" /> Approved
                </div>
                {isSuperAdmin && (
                  <button
                    onClick={() => updateStatus("AdminSave")}
                    className="w-full h-10 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Settings size={16} /> บันทึกแก้ไข (History Mode)
                  </button>
                )}
              </div>
            )}
            {isSuperAdmin && (
              <button
                onClick={() => onDelete(ticket.id, ticket.status)}
                className="w-full h-10 text-red-500 hover:bg-red-50 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
              >
                <Trash2 size={14} /> ลบรายการนี้
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 6. CREATE TICKET MODAL (Smart Counter: Auto-Skip if ID exists)
// ==========================================
function CreateTicketModal({
  user,
  onClose,
}: {
  user: User;
  onClose: () => void;
}) {
  const [jobType, setJobType] = useState("");
  const [otherJobType, setOtherJobType] = useState("");
  const [issueItem, setIssueItem] = useState("");
  const [department, setDepartment] = useState("");
  const [machineName, setMachineName] = useState("");
  const [factory, setFactory] = useState<"SAL01" | "SAL02">("SAL01");
  const [area, setArea] = useState("");
  const [otherArea, setOtherArea] = useState("");
  const [creating, setCreating] = useState(false);

  const [deptOptions, setDeptOptions] = useState<
    { name: string; code: string }[]
  >([]);
  const [jobOptions, setJobOptions] = useState<string[]>([]);
  const [sal01Options, setSal01Options] = useState<string[]>([]);
  const [sal02Options, setSal02Options] = useState<string[]>([]);

  useEffect(() => {
    const fetch = async () => {
      const getList = async (id: string) => {
        const docSnap = await getDoc(doc(db, "maintenance_settings", id));
        if (!docSnap.exists()) return [];
        const list = docSnap.data().list || [];
        if (id === "departments") {
          return list.map((item: any) =>
            typeof item === "object"
              ? { name: item.name, code: item.code || "MT" }
              : { name: item, code: "MT" }
          );
        }
        return list;
      };
      setDeptOptions(await getList("departments"));
      setJobOptions(await getList("job_types"));
      setSal01Options(await getList("sal01_areas"));
      setSal02Options(await getList("sal02_areas"));
    };
    fetch();
  }, []);

  useEffect(() => {
    if (deptOptions.length && !department) setDepartment(deptOptions[0].name);
    if (jobOptions.length && !jobType) setJobType(jobOptions[0]);
    const currentArea = factory === "SAL01" ? sal01Options : sal02Options;
    if (currentArea.length) setArea(currentArea[0]);
  }, [deptOptions, jobOptions, sal01Options, sal02Options, factory]);

  const handleCreate = async () => {
    if (!machineName || !issueItem || !area) {
      alert("กรอกข้อมูลไม่ครบ");
      return;
    }
    setCreating(true);
    try {
      const selectedDeptObj = deptOptions.find((d) => d.name === department);
      const prefixCode = selectedDeptObj?.code || "MT";

      const resultId = await runTransaction(db, async (transaction) => {
        const counterRef = doc(db, "maintenance_settings", "ticket_counter");
        const counterSnap = await transaction.get(counterRef);

        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const currentYM = `${yy}${mm}`;

        let nextCount = 1;
        if (counterSnap.exists()) {
          const data = counterSnap.data();
          if (data.year_month === currentYM) {
            nextCount = data.count + 1;
          } else {
            nextCount = 1;
          }
        }

        // --- เพิ่ม LOGIC ป้องกันการทับ ID (Loop Check) ---
        let newTicketId = "";
        let isIdUnique = false;

        // วนลูปเช็คว่า ID นี้มีคนใช้ไปหรือยัง (เช่น กรณีแก้เลข manual)
        while (!isIdUnique) {
          const running = String(nextCount).padStart(3, "0");
          newTicketId = `${prefixCode}-${currentYM}-${running}`;

          // ลองดึง doc นี้มาดูว่ามีอยู่แล้วไหม
          const existingDoc = await transaction.get(
            doc(db, "maintenance_tickets", newTicketId)
          );

          if (existingDoc.exists()) {
            // ถ้ามีแล้ว (ซ้ำ) ให้ขยับเลขไปอีก 1 แล้ววนลูปใหม่
            nextCount++;
          } else {
            // ถ้าว่าง (ไม่ซ้ำ) ก็ใช้เลขนี้ได้เลย
            isIdUnique = true;
          }
        }
        // ----------------------------------------------

        // อัปเดตตัวนับล่าสุดกลับไปที่ DB (ข้ามเลขที่ซ้ำไปเลย)
        transaction.set(
          counterRef,
          {
            count: nextCount,
            year_month: currentYM,
          },
          { merge: true }
        );

        // สร้างใบงาน
        transaction.set(doc(db, "maintenance_tickets", newTicketId), {
          id: newTicketId,
          machine_id: "MANUAL",
          machine_name: machineName,
          job_type: jobType === "อื่นๆ" ? `อื่นๆ (${otherJobType})` : jobType,
          department,
          factory,
          area: area === "อื่นๆ" ? `อื่นๆ (${otherArea})` : area,
          issue_item: issueItem,
          issue_detail: "",
          status: "Open",
          source: "Manual",
          requester: user.username,
          requester_fullname: user.fullname || user.username,
          requester_date: new Date().toISOString().split("T")[0],
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        });

        return newTicketId;
      });

      const msg = `🆕<b>แจ้งซ่อมใหม่:</b> ${resultId}\n🏢<b>แผนก:</b> ${department}\n⚙️<b>เครื่อง:</b> ${machineName}\n⚠️<b>อาการ:</b> ${issueItem}\n👤<b>ผู้แจ้ง:</b> ${user.fullname}`;
      try {
        await sendTelegram(msg);
      } catch (e) {
        console.error(e);
      }

      onClose();
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e);
      console.error(e);
      setCreating(false);
    }
  };

  const inputClass =
    "w-full border border-gray-300 p-2 rounded-lg text-base bg-white focus:ring-2 focus:ring-orange-200 outline-none";
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-5 overflow-y-auto max-h-[90vh]">
        <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
          <Hammer className="text-orange-600" /> แจ้งซ่อม
        </h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">
                แผนก
              </label>
              <select
                className={inputClass}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                {deptOptions.map((o, i) => (
                  <option key={i} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">
                ประเภทงาน
              </label>
              <select
                className={inputClass}
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
              >
                {jobOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                <option value="อื่นๆ">อื่นๆ</option>
              </select>
            </div>
          </div>
          {jobType === "อื่นๆ" && (
            <input
              className={inputClass}
              placeholder="ระบุประเภทงาน..."
              value={otherJobType}
              onChange={(e) => setOtherJobType(e.target.value)}
            />
          )}
          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">
              ชื่อเครื่องจักร / อุปกรณ์
            </label>
            <input
              className={inputClass}
              placeholder="Ex. CNC-01, ปั๊มน้ำ, แอร์..."
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">
              อาการเสีย / ปัญหา
            </label>
            <textarea
              className={inputClass}
              rows={3}
              placeholder="ระบุอาการ..."
              value={issueItem}
              onChange={(e) => setIssueItem(e.target.value)}
            />
          </div>
          <div className="bg-blue-50 p-2 rounded border border-blue-100">
            <div className="flex gap-4 mb-2">
              <label className="flex gap-1 text-xs font-bold items-center">
                <input
                  type="radio"
                  checked={factory === "SAL01"}
                  onChange={() => setFactory("SAL01")}
                />{" "}
                SAL01
              </label>
              <label className="flex gap-1 text-xs font-bold items-center">
                <input
                  type="radio"
                  checked={factory === "SAL02"}
                  onChange={() => setFactory("SAL02")}
                />{" "}
                SAL02
              </label>
            </div>
            <select
              className={inputClass}
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              {(factory === "SAL01" ? sal01Options : sal02Options).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              <option value="อื่นๆ">อื่นๆ</option>
            </select>
            {area === "อื่นๆ" && (
              <input
                className={`${inputClass} mt-2`}
                placeholder="ระบุสถานที่..."
                value={otherArea}
                onChange={(e) => setOtherArea(e.target.value)}
              />
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-4 pt-2 border-t">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex-1 py-3 bg-orange-600 disabled:bg-gray-400 text-white font-bold text-sm rounded-lg hover:bg-orange-700 shadow-md transition-colors"
          >
            {creating ? "กำลังส่งข้อมูล..." : "แจ้งซ่อม"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 7. MANAGE USERS MODAL
// ==========================================
function ManageUsersModal({
  onClose,
  userPass,
}: {
  onClose: () => void;
  userPass: string;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [fullname, setFullname] = useState("");
  const [role, setRole] = useState<UserRole>("requester");
  const [showGuard, setShowGuard] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users_maintenance"), (s) => {
      setUsers(
        s.docs
          .map((d) => ({ id: d.id, ...d.data() } as User))
          .sort((a, b) => a.username.localeCompare(b.username))
      );
    });
    return () => unsub();
  }, []);
  const handleAddUser = async () => {
    if (!u || !p || !fullname) return alert("กรอกข้อมูลไม่ครบ");
    await addDoc(collection(db, "users_maintenance"), {
      username: u,
      pass: p,
      fullname,
      role,
      created_at: serverTimestamp(),
    });
    setU("");
    setP("");
    setFullname("");
    alert("เพิ่มผู้ใช้แล้ว");
  };
  const confirmDelete = async () => {
    if (pendingDeleteId) {
      await deleteDoc(doc(db, "users_maintenance", pendingDeleteId));
      setPendingDeleteId("");
    }
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6 h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b pb-3">
          <h3 className="text-xl font-bold flex gap-2 items-center text-gray-800">
            <UserPlus className="text-orange-600" /> จัดการผู้ใช้งาน
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>
        <div className="bg-gray-50 p-4 rounded-xl mb-4 space-y-2">
          <input
            className="w-full border p-2 rounded text-sm"
            placeholder="ชื่อ-นามสกุล"
            value={fullname}
            onChange={(e) => setFullname(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="border p-2 rounded text-sm"
              placeholder="User"
              value={u}
              onChange={(e) => setU(e.target.value)}
            />
            <input
              className="border p-2 rounded text-sm"
              placeholder="Pass"
              value={p}
              onChange={(e) => setP(e.target.value)}
            />
          </div>
          <select
            className="w-full border p-2 rounded text-sm bg-white"
            value={role}
            onChange={(e: any) => setRole(e.target.value)}
          >
            <option value="super_admin">1. Super Admin</option>
            <option value="supervisor">2. Supervisor</option>
            <option value="technician">3. Technician</option>
            <option value="requester">4. Requester</option>
          </select>
          <button
            onClick={handleAddUser}
            className="w-full bg-orange-600 text-white py-2 rounded font-bold text-sm hover:bg-orange-700"
          >
            เพิ่มผู้ใช้
          </button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2">
          {users.map((us) => (
            <div
              key={us.id}
              className="flex justify-between items-center p-3 border rounded hover:bg-gray-50"
            >
              <div>
                <div className="font-bold text-sm">{us.username}</div>
                <div className="text-xs text-gray-500">
                  {us.fullname} ({us.role})
                </div>
              </div>
              {us.username !== "Bank" && (
                <button
                  onClick={() => {
                    setPendingDeleteId(us.id!);
                    setShowGuard(true);
                  }}
                  className="text-gray-400 hover:text-red-500 p-2 rounded-full hover:bg-red-50"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <ConfirmPasswordModal
        isOpen={showGuard}
        onClose={() => setShowGuard(false)}
        onConfirm={confirmDelete}
        userPass={userPass}
        message="ยืนยันรหัสผ่านเพื่อลบผู้ใช้"
      />
    </div>
  );
}

// ==========================================
// 8. SETTINGS MODAL
// ==========================================
function SettingsModal({
  onClose,
  userPass,
}: {
  onClose: () => void;
  userPass: string;
}) {
  const [activeTab, setActiveTab] = useState("dept");
  const [items, setItems] = useState<
    { id: string; val: string; code?: string }[]
  >([]);
  const [newItem, setNewItem] = useState("");
  const [newCode, setNewCode] = useState("");
  const [editObj, setEditObj] = useState<{
    id: string;
    val: string;
    code?: string;
  } | null>(null);
  const [showGuard, setShowGuard] = useState(false);
  const [guardMessage, setGuardMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<
    () => Promise<void> | void
  >(() => {});
  const getDocId = () => {
    if (activeTab === "dept") return "departments";
    if (activeTab === "job") return "job_types";
    if (activeTab === "sal01") return "sal01_areas";
    if (activeTab === "sal02") return "sal02_areas";
    if (activeTab === "cause") return "cause_categories";
    return "maintenance_results";
  };
  useEffect(() => {
    cancelEdit();
    const unsub = onSnapshot(
      doc(db, "maintenance_settings", getDocId()),
      (s) => {
        if (s.exists()) {
          const data = s.data().list || [];
          setItems(
            data.map((item: any) =>
              typeof item === "object"
                ? { id: item.name, val: item.name, code: item.code || "" }
                : { id: item, val: item, code: "" }
            )
          );
        } else {
          setItems([]);
        }
      }
    );
    return () => unsub();
  }, [activeTab]);
  const handleAdd = async () => {
    if (!newItem.trim()) return;
    const docRef = doc(db, "maintenance_settings", getDocId());
    let itemToSave: any = newItem;
    if (activeTab === "dept") {
      itemToSave = { name: newItem, code: newCode };
    }
    const currentList = items.map((i) =>
      activeTab === "dept" && i.code !== undefined
        ? { name: i.val, code: i.code }
        : i.val
    );
    await updateDoc(docRef, { list: [...currentList, itemToSave] });
    setNewItem("");
    setNewCode("");
  };
  const startEdit = (item: { id: string; val: string; code?: string }) => {
    setEditObj(item);
    setNewItem(item.val);
    setNewCode(item.code || "");
  };
  const cancelEdit = () => {
    setEditObj(null);
    setNewItem("");
    setNewCode("");
  };
  const handleSaveEdit = () => {
    if (!newItem.trim() || !editObj) return;
    setGuardMessage("ยืนยันรหัสผ่านเพื่อแก้ไขข้อมูล");
    setPendingAction(() => async () => {
      const docRef = doc(db, "maintenance_settings", getDocId());
      const updatedList = items.map((i) => {
        if (i.id === editObj.id)
          return activeTab === "dept"
            ? { name: newItem, code: newCode }
            : newItem;
        return activeTab === "dept" ? { name: i.val, code: i.code } : i.val;
      });
      await updateDoc(docRef, { list: updatedList });
      cancelEdit();
    });
    setShowGuard(true);
  };
  const handleDelete = (valToDelete: string) => {
    setGuardMessage("ยืนยันรหัสผ่านเพื่อลบข้อมูล");
    setPendingAction(() => async () => {
      const docRef = doc(db, "maintenance_settings", getDocId());
      const currentListRaw = items.map((i) =>
        activeTab === "dept" && i.code !== undefined
          ? { name: i.val, code: i.code }
          : i.val
      );
      const newList = currentListRaw.filter(
        (item: any) =>
          (typeof item === "object" ? item.name : item) !== valToDelete
      );
      await updateDoc(docRef, { list: newList });
    });
    setShowGuard(true);
  };
  const tabs = [
    { id: "dept", label: "แผนก" },
    { id: "job", label: "งาน" },
    { id: "sal01", label: "S01" },
    { id: "sal02", label: "S02" },
    { id: "cause", label: "สาเหตุ" },
    { id: "result", label: "ผลซ่อม" },
  ];
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6 h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b pb-3">
          <h3 className="text-xl font-bold flex gap-2 items-center text-gray-800">
            <Settings className="text-gray-700" /> ตั้งค่าข้อมูล
          </h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-4 overflow-x-auto shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id);
                cancelEdit();
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded whitespace-nowrap transition-all ${
                activeTab === t.id
                  ? "bg-white shadow text-orange-600"
                  : "text-gray-500 hover:bg-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mb-4 shrink-0 items-end">
          <div className="flex-1 flex gap-2">
            <div className="flex-1">
              <span className="text-[10px] text-gray-400 ml-1 mb-1 block">
                {editObj
                  ? "แก้ไขข้อมูล:"
                  : activeTab === "dept"
                  ? "ชื่อแผนก"
                  : "ชื่อรายการ"}
              </span>
              <input
                className={`w-full border rounded px-3 py-2 text-sm outline-none transition-all ${
                  editObj
                    ? "border-blue-500 ring-1 ring-blue-200"
                    : "border-gray-200 focus:border-orange-500"
                }`}
                placeholder="ระบุข้อมูล..."
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
              />
            </div>
            {activeTab === "dept" && (
              <div className="w-24">
                <span className="text-[10px] text-gray-400 ml-1 mb-1 block">
                  รหัส
                </span>
                <input
                  className={`w-full border rounded px-3 py-2 text-sm outline-none transition-all ${
                    editObj
                      ? "border-blue-500 ring-1 ring-blue-200"
                      : "border-gray-200 focus:border-orange-500"
                  }`}
                  placeholder="รหัส"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                />
              </div>
            )}
          </div>
          {editObj ? (
            <div className="flex gap-1">
              <button
                onClick={handleSaveEdit}
                className="bg-blue-600 text-white p-2.5 rounded hover:bg-blue-700 transition-colors"
                title="บันทึก"
              >
                <Save size={18} />
              </button>
              <button
                onClick={cancelEdit}
                className="bg-gray-200 text-gray-600 p-2.5 rounded hover:bg-gray-300 transition-colors"
                title="ยกเลิก"
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleAdd}
              className="bg-orange-600 text-white p-2.5 rounded hover:bg-orange-700 transition-colors"
              title="เพิ่ม"
            >
              <Plus size={18} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {items.length === 0 && (
            <div className="text-center text-gray-300 text-sm py-8">
              ไม่มีข้อมูล
            </div>
          )}
          {items.map((i, idx) => (
            <div
              key={idx}
              className={`flex justify-between p-3 border rounded items-center transition-all ${
                editObj?.id === i.id
                  ? "bg-blue-50 border-blue-200"
                  : "bg-white hover:border-orange-200"
              }`}
            >
              <div className="text-sm text-gray-700">
                <span className="font-medium">{i.val}</span>
                {i.code && (
                  <span className="text-xs text-gray-400 ml-2 bg-gray-100 px-1.5 py-0.5 rounded">
                    #{i.code}
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => startEdit(i)}
                  disabled={!!editObj}
                  className={`p-1.5 rounded transition-colors ${
                    editObj
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-400 hover:text-blue-500 hover:bg-blue-50"
                  }`}
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => handleDelete(i.val)}
                  disabled={!!editObj}
                  className={`p-1.5 rounded transition-colors ${
                    editObj
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-gray-400 hover:text-red-500 hover:bg-red-50"
                  }`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <ConfirmPasswordModal
        isOpen={showGuard}
        onClose={() => setShowGuard(false)}
        onConfirm={pendingAction}
        userPass={userPass}
        message={guardMessage}
      />
    </div>
  );
}

// ==========================================
// 9. MAIN DASHBOARD
// ==========================================
function MaintenanceDashboard({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [activeTab, setActiveTab] = useState<number>(1);
  const [selectedTicket, setSelectedTicket] =
    useState<MaintenanceTicket | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPasswordGuard, setShowPasswordGuard] = useState(false);
  const [guardMessage, setGuardMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<() => void>(() => {});
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [historyDept, setHistoryDept] = useState("All");

  useEffect(() => {
    const q = query(
      collection(db, "maintenance_tickets"),
      orderBy("created_at", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setTickets(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceTicket))
      );
    });
    return () => unsub();
  }, []);

  const allDepartments = useMemo(() => {
    const depts = tickets.map((t) => t.department).filter((d) => d);
    return Array.from(new Set(depts)).sort();
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    let result: MaintenanceTicket[] = [];
    switch (activeTab) {
      case 1:
        result = tickets.filter((t) => t.status === "Open");
        break;
      case 2:
        result = tickets.filter(
          (t) => t.status === "In_Progress" || t.status === "Waiting_Part"
        );
        break;
      case 3:
        result = tickets.filter((t) => t.status === "Wait_Verify");
        break;
      case 4:
        result = tickets.filter((t) => t.status === "Wait_Approve");
        break;
      case 5:
        result = tickets.filter((t) => {
          if (t.status !== "Closed") return false;
          const dateToCheck = t.closed_at
            ? t.closed_at.toDate()
            : t.created_at.toDate();
          return (
            dateToCheck.toISOString().slice(0, 7) === historyMonth &&
            (historyDept === "All" || t.department === historyDept)
          );
        });
        break;
      default:
        result = [];
    }

    // เรียงตามแผนก (A-Z) -> แล้วค่อยเรียงตามเลขที่ใบงาน (Ticket ID)
    return result.sort((a, b) => {
      const deptCompare = (a.department || "").localeCompare(
        b.department || "",
        "th"
      );
      if (deptCompare !== 0) return deptCompare;
      return (a.id || "").localeCompare(b.id || "");
    });
  }, [tickets, activeTab, historyMonth, historyDept]);

  const getCount = (status: string) =>
    tickets.filter((t) => t.status === status).length;
  const tabs = [
    {
      id: 1,
      label: "แจ้งซ่อม",
      icon: <ListTodo size={16} />,
      count: getCount("Open"),
      color: "text-red-600",
    },
    {
      id: 2,
      label: "กำลังซ่อม",
      icon: <Wrench size={16} />,
      count: tickets.filter(
        (t) => t.status === "In_Progress" || t.status === "Waiting_Part"
      ).length,
      color: "text-blue-600",
    },
    {
      id: 3,
      label: "ตรวจรับงาน",
      icon: <UserCheck size={16} />,
      count: getCount("Wait_Verify"),
      color: "text-purple-600",
    },
    {
      id: 4,
      label: "Approved",
      icon: <Crown size={16} />,
      count: getCount("Wait_Approve"),
      color: "text-orange-600",
    },
    {
      id: 5,
      label: "History",
      icon: <History size={16} />,
      count: 0,
      color: "text-gray-600",
    },
  ];

  // ฟังก์ชันลบใบงาน (มี Logic คืนเลขรัน ถ้ายังไม่ Approve และเป็นใบสุดท้าย)
  const handleDeleteTicket = (id: string, status: string) => {
    setGuardMessage("คุณต้องการลบรายการนี้ใช่หรือไม่?");
    setPendingAction(() => async () => {
      try {
        await runTransaction(db, async (transaction) => {
          const counterRef = doc(db, "maintenance_settings", "ticket_counter");
          const ticketRef = doc(db, "maintenance_tickets", id);

          const counterSnap = await transaction.get(counterRef);
          // ดึงเลขจาก ID (เช่น MT-2512-005 -> 5)
          const ticketNum = parseInt(id.split("-").pop() || "0");
          const currentCount = counterSnap.exists()
            ? counterSnap.data().count
            : 0;

          // ถ้ายังไม่ Approved และเป็นใบงานล่าสุด -> ถอยเลข Counter
          const isApproved = ["Wait_Approve", "Closed"].includes(status);
          if (!isApproved && ticketNum === currentCount) {
            transaction.update(counterRef, { count: currentCount - 1 });
          }

          transaction.delete(ticketRef);
        });
        setSelectedTicket(null);
        alert("ลบรายการเรียบร้อย");
      } catch (e) {
        alert("เกิดข้อผิดพลาดในการลบ: " + e);
      }
    });
    setShowPasswordGuard(true);
  };

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };
  const handleSelectAll = () => {
    if (filteredTickets.length === 0) return;
    if (selectedIds.size === filteredTickets.length) {
      setSelectedIds(new Set());
    } else {
      const allIds = new Set(filteredTickets.map((t) => t.id));
      setSelectedIds(allIds);
      setIsSelectionMode(true);
    }
  };
  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return alert("กรุณาเลือกรายการที่ต้องการลบ");
    setGuardMessage(`ยืนยันลบ ${selectedIds.size} รายการที่เลือก?`);
    setPendingAction(() => async () => {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.delete(doc(db, "maintenance_tickets", id));
      });
      await batch.commit();
      setIsSelectionMode(false);
      setSelectedIds(new Set());
      alert("ลบข้อมูลเรียบร้อย");
    });
    setShowPasswordGuard(true);
  };
  const handleExportPreview = () => {
    if (selectedIds.size === 0) return alert("กรุณาเลือกรายการที่จะ Export");
    const ticketsToExport = tickets
      .filter((t) => selectedIds.has(t.id))
      .sort((a, b) => a.created_at - b.created_at);
    const doc = generateMaintenancePDF(ticketsToExport);
    const blobUrl = doc.output("bloburl");
    setPdfBlobUrl(blobUrl.toString());
    setShowPdfPreview(true);
  };
  const handleDownloadPDF = () => {
    if (selectedIds.size === 0) return alert("กรุณาเลือกรายการที่จะดาวน์โหลด");
    const ticketsToExport = tickets
      .filter((t) => selectedIds.has(t.id))
      .sort((a, b) => a.created_at - b.created_at);
    ticketsToExport.forEach((ticket, index) => {
      const doc = generateMaintenancePDF([ticket]);
      const filename = `${ticket.id}.pdf`;
      setTimeout(() => {
        doc.save(filename);
      }, index * 500);
    });
    setShowPdfPreview(false);
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  const isSuperOrOwner =
    user.role === "super_admin" || user.username === "Bank";
  const canCreateTicket = user.role === "requester" || isSuperOrOwner;

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50 overflow-hidden">
      <div className="flex-none bg-white shadow-sm z-20 border-b">
        <div className="max-w-7xl mx-auto w-full px-4 py-3 flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Wrench className="text-orange-600" size={20} /> Maintenance
            </h1>
            <p className="text-[10px] text-gray-500">
              {user.fullname} ({user.role})
            </p>
          </div>
          <div className="flex gap-2">
            {(user.role === "super_admin" || user.username === "Bank") && (
              <>
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"
                >
                  <Settings size={18} />
                </button>
                <button
                  onClick={() => setShowUserModal(true)}
                  className="p-2 bg-orange-50 text-orange-600 rounded-full border border-orange-200 hover:bg-orange-100"
                >
                  <UserPlus size={18} />
                </button>
              </>
            )}
            <button
              onClick={onLogout}
              className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto w-full overflow-x-auto no-scrollbar md:overflow-visible border-t border-gray-100">
          <div className="flex px-2 min-w-max md:w-full md:justify-center">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id);
                  setIsSelectionMode(false);
                  setSelectedIds(new Set());
                }}
                className={`flex flex-col items-center justify-center py-2 px-4 min-w-[80px] md:flex-1 md:flex-row md:gap-2 border-b-2 transition-all ${
                  activeTab === t.id
                    ? `border-orange-500 ${t.color} bg-orange-50/50`
                    : "border-transparent text-gray-400 hover:bg-gray-50"
                }`}
              >
                <div className="relative">
                  {t.icon}
                  {t.count > 0 && (
                    <span className="absolute -top-2 -right-3 bg-red-500 text-white text-[9px] px-1.5 rounded-full shadow-sm">
                      {t.count}
                    </span>
                  )}
                </div>
                <span className="text-[10px] md:text-sm font-bold mt-1 md:mt-0">
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>
        {activeTab === 5 && (
          <div className="bg-gray-50 border-t py-2 px-4">
            <div className="max-w-7xl mx-auto flex flex-wrap gap-2 justify-between items-center">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    setSelectedIds(new Set());
                  }}
                  className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-all ${
                    isSelectionMode
                      ? "bg-gray-700 text-white border-gray-700"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <MousePointer2 size={14} />{" "}
                  {isSelectionMode ? "ปิดการเลือก" : "เลือกรายการ"}
                </button>
                {isSelectionMode && (
                  <button
                    onClick={handleSelectAll}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border bg-white text-gray-600 border-gray-300 hover:bg-gray-50 transition-colors"
                  >
                    <CheckSquare size={14} /> เลือกทั้งหมด
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={historyDept}
                  onChange={(e) => setHistoryDept(e.target.value)}
                  className="text-xs border border-gray-300 rounded-lg px-2 py-1 outline-none bg-white text-gray-700 cursor-pointer hover:border-gray-400 max-w-[100px]"
                >
                  <option value="All">ทุกแผนก</option>
                  {allDepartments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-gray-300 shadow-sm">
                  <Calendar size={14} className="text-gray-500" />
                  <input
                    type="month"
                    className="text-xs text-gray-700 outline-none bg-transparent cursor-pointer w-[100px]"
                    value={historyMonth}
                    onChange={(e) => setHistoryMonth(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 pb-24 max-w-7xl mx-auto w-full custom-scrollbar">
        {filteredTickets.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-300">
            <CheckCircle2 size={40} className="mb-2 opacity-20" />
            <p className="text-sm">ไม่มีรายการในสถานะนี้</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onClick={() => {
                  if (isSelectionMode) handleToggleSelect(ticket.id);
                  else setSelectedTicket(ticket);
                }}
                isSelectionMode={isSelectionMode}
                isSelected={selectedIds.has(ticket.id)}
                onToggleSelect={handleToggleSelect}
              />
            ))}
          </div>
        )}
      </div>
      {!isSelectionMode && canCreateTicket && (
        <button
          onClick={() => setShowCreate(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-gray-900 text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-gray-800 z-30 active:scale-95 transition-transform"
        >
          <Hammer size={24} />
        </button>
      )}
      {isSelectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom duration-200 flex gap-3">
          <button
            onClick={handleExportPreview}
            className="bg-white text-blue-600 border border-blue-100 px-6 py-3 rounded-full font-bold text-sm hover:bg-blue-50 shadow-xl flex items-center gap-2"
          >
            <Eye size={18} /> Preview
          </button>
          <button
            onClick={handleDownloadPDF}
            className="bg-blue-600 text-white px-6 py-3 rounded-full font-bold text-sm hover:bg-blue-700 shadow-xl flex items-center gap-2"
          >
            <Download size={18} /> Download
          </button>
          {isSuperOrOwner && (
            <button
              onClick={handleBatchDelete}
              className="bg-red-600 text-white px-6 py-3 rounded-full font-bold text-sm hover:bg-red-700 shadow-xl flex items-center gap-2"
            >
              <Trash2 size={18} /> ลบข้อมูล
            </button>
          )}
        </div>
      )}
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          user={user}
          onClose={() => setSelectedTicket(null)}
          onDelete={handleDeleteTicket}
        />
      )}
      {showCreate && (
        <CreateTicketModal user={user} onClose={() => setShowCreate(false)} />
      )}
      {showUserModal && (
        <ManageUsersModal
          onClose={() => setShowUserModal(false)}
          userPass={user.pass}
        />
      )}
      {showSettingsModal && (
        <SettingsModal
          onClose={() => setShowSettingsModal(false)}
          userPass={user.pass}
        />
      )}
      <ConfirmPasswordModal
        isOpen={showPasswordGuard}
        onClose={() => setShowPasswordGuard(false)}
        onConfirm={pendingAction}
        userPass={user.pass}
        message={guardMessage}
      />
      <PDFPreviewModal
        isOpen={showPdfPreview}
        onClose={() => setShowPdfPreview(false)}
        pdfUrl={pdfBlobUrl}
        onDownload={handleDownloadPDF}
      />
    </div>
  );
}

// ==========================================
// 10. MAIN APP COMPONENT
// ==========================================
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  if (!user) return <LoginPage onLogin={setUser} />;
  return <MaintenanceDashboard user={user} onLogout={() => setUser(null)} />;
}
