import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminSettings,
  useUpdateAdminSettings,
  useAdminGetPendingListings,
  useAdminApproveListing,
  useAdminDeleteListing,
  useAdminCreateAd,
  useAdminGetAllAds,
  useAdminDeleteAd,
  useAdminPinAd,
  useAdminGetVendors,
  useAdminActivateVendor,
  useAdminDeleteVendor,
  useAdminResetVendorPassword,
  useAdminCreateEvent,
  useAdminDeleteEvent,
  useGetEvents,
  useGetAdminContactStats,
  useAdminCreateService,
  useAdminGetAllServices,
  useAdminDeleteService,
  useAdminStorageCleanup,
  getGetListingsQueryKey,
  getGetEventsQueryKey,
  getGetServicesQueryKey,
  getGetAdminSettingsQueryKey,
  type Ad,
  type VendorProfile,
  type Event as ApiEvent,
  type Service,
  type AdminContactStat,
} from "@workspace/api-client-react";
import { loadAdminSession, clearAdminSession } from "./admin-login";
import { resolveImageUrl, resizeImageToBlob, isVideoMedia, resolveMediaUrl } from "@/lib/image";
import { uploadImageFile, uploadVideoFile } from "@/lib/upload";
import { openWhatsApp } from "@/lib/whatsapp";
import { ImageViewer } from "@/components/image-viewer";
import { SmartVideo } from "@/components/smart-video";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutDashboard,
  Clock,
  Users,
  Megaphone,
  Calendar,
  Briefcase,
  Settings,
  LogOut,
  CheckCircle,
  Trash2,
  KeyRound,
  Plus,
  RefreshCw,
  Eye,
  EyeOff,
  Shield,
  ShieldAlert,
  Search,
  ChevronDown,
  ChevronUp,
  Phone,
  X,
  Pin,
  MapPin,
  Tag,
  Clock3,
  ExternalLink,
  MessageSquare,
  Send,
  ArrowLeft,
  Mic,
  StopCircle,
  FileText,
  Paperclip,
  MoreVertical,
  Pencil,
} from "lucide-react";

type DashTab =
  | "stats"
  | "pending"
  | "vendors"
  | "ads"
  | "events"
  | "services"
  | "settings"
  | "accounts"
  | "inbox";

interface InboxConv {
  id: number;
  vendorId: number;
  vendorFirstName: string;
  vendorLastName: string;
  vendorPhone: string;
  updatedAt: string;
  adminUnreadCount: number;
  lastMessage: string | null;
  lastSenderType: "buyer" | "vendor" | null;
}

interface InboxMessage {
  id: number;
  conversationId: number;
  senderType: string;
  content: string | null;
  fileUrl: string | null;
  fileType: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
}

interface AdminAccount {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

interface AdminStats {
  vendors: { total: number; paid: number; admin: number };
  ads: { total: number; paid: number; admin: number };
  events: { total: number; paid: number; admin: number };
  services: { total: number; paid: number; admin: number };
  expiringSoon: Array<{ id: number; firstName: string; lastName: string; phone: string; expiryDate: string | null }>;
}

/** Thumbnail (h-20 w-20) — détecte automatiquement les vidéos.
 *  Pour les vidéos, appelle onVideoClick(resolvedUrl) au lieu de onClick. */
function AdminMediaThumb({
  path,
  onClick,
  onVideoClick,
}: {
  path: string;
  onClick?: () => void;
  onVideoClick?: (url: string) => void;
}) {
  const [isVid, setIsVid] = useState(isVideoMedia(path));
  const handleVidClick = () => onVideoClick?.(resolveMediaUrl(path));
  if (isVid) {
    return (
      <div
        className="h-20 w-20 rounded-lg flex-shrink-0 overflow-hidden bg-black relative cursor-pointer"
        onClick={handleVidClick}
      >
        <video src={resolveMediaUrl(path)} className="w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-full w-8 h-8 flex items-center justify-center">
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
    );
  }
  return (
    <img
      src={resolveImageUrl(path)}
      alt=""
      className="h-20 w-20 object-cover rounded-lg flex-shrink-0 cursor-pointer"
      onClick={onClick}
      onError={() => setIsVid(true)}
    />
  );
}

/** Slide plein-écran dans le carousel du modal — vidéo avec controls si besoin. */
function AdminMediaSlide({ path, onClick }: { path: string; onClick?: () => void }) {
  const [isVid, setIsVid] = useState(isVideoMedia(path));
  if (isVid) {
    return (
      <div className="w-full flex-shrink-0 snap-center bg-black flex items-center justify-center max-h-72 overflow-hidden">
        <video src={resolveMediaUrl(path)} controls playsInline className="w-full max-h-72 object-contain" />
      </div>
    );
  }
  return (
    <img
      src={resolveImageUrl(path)}
      alt=""
      className="w-full flex-shrink-0 snap-center object-cover max-h-72 cursor-pointer"
      onClick={onClick}
      onError={() => setIsVid(true)}
    />
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div className="bg-card border rounded-xl p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${color ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const session = loadAdminSession();
  const isSuperAdmin = session?.role === "superadmin";

  useEffect(() => {
    if (!session) {
      navigate("/admin-login");
    }
  }, []);

  if (!session) return null;

  const password = session.code;

  const initialTab = (): DashTab => {
    if (!session) return "stats";
    // Restricted roles are always sent to their designated tab
    if (session.role === "admin_pub") return "ads";
    if (session.role === "admin_event") return "events";
    if (session.role === "admin_service") return "services";
    if (session.role === "admin_stats") return "stats";
    // Superadmin / full admin: restore the last tab the user was on before refresh
    const saved = sessionStorage.getItem("tm_admin_tab") as DashTab | null;
    const valid: DashTab[] = ["stats", "pending", "vendors", "ads", "events", "services", "settings", "accounts", "inbox"];
    if (saved && valid.includes(saved)) return saved;
    return "stats";
  };
  const [tab, setTab] = useState<DashTab>(initialTab);

  // Persist active tab so a page refresh lands on the same tab
  useEffect(() => {
    sessionStorage.setItem("tm_admin_tab", tab);
  }, [tab]);
  const [vendorSearch, setVendorSearch] = useState("");
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{ sent: number } | "error" | null>(null);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [videoPlayerUrl, setVideoPlayerUrl] = useState<string | null>(null);

  // ── INBOX ────────────────────────────────────────────────────
  const [inboxConvs, setInboxConvs] = useState<InboxConv[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [selectedInboxConv, setSelectedInboxConv] = useState<InboxConv | null>(null);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [inboxMsgsLoading, setInboxMsgsLoading] = useState(false);
  const [inboxReply, setInboxReply] = useState("");
  const [inboxReplying, setInboxReplying] = useState(false);
  const [inboxMenuMsgId, setInboxMenuMsgId] = useState<number | null>(null);
  const [inboxMenuPos, setInboxMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [inboxEditingId, setInboxEditingId] = useState<number | null>(null);
  const [inboxEditContent, setInboxEditContent] = useState("");
  const [inboxUploading, setInboxUploading] = useState(false);
  const [inboxIsRecording, setInboxIsRecording] = useState(false);
  const [inboxRecordingDuration, setInboxRecordingDuration] = useState(0);
  const inboxBottomRef = useRef<HTMLDivElement>(null);
  const inboxFileInputRef = useRef<HTMLInputElement>(null);
  const inboxMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const inboxAudioChunksRef = useRef<Blob[]>([]);
  const inboxRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalInboxUnread = inboxConvs.reduce((s, c) => s + c.adminUnreadCount, 0);

  async function loadInbox() {
    setInboxLoading(true);
    try {
      const res = await fetch("/api/admin/broadcast-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) return;
      const data = await res.json() as { conversations: InboxConv[] };
      setInboxConvs(data.conversations ?? []);
    } finally {
      setInboxLoading(false);
    }
  }

  async function openInboxConv(conv: InboxConv) {
    // Pousse une entrée d'historique fictive pour que le bouton ← Android
    // revienne à la liste plutôt que de quitter le panneau admin.
    history.pushState({ inboxThread: conv.id }, "", window.location.href);
    setSelectedInboxConv(conv);
    setInboxMsgsLoading(true);
    setInboxMessages([]);
    try {
      const [msgsRes] = await Promise.all([
        fetch(`/api/admin/broadcast-inbox/${conv.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        }),
        // Mark as read
        fetch(`/api/admin/broadcast-inbox/${conv.id}/read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        }),
      ]);
      if (msgsRes.ok) {
        const data = await msgsRes.json() as { messages: InboxMessage[] };
        setInboxMessages(data.messages ?? []);
      }
      // Update local unread count to 0
      setInboxConvs(prev => prev.map(c => c.id === conv.id ? { ...c, adminUnreadCount: 0 } : c));
    } finally {
      setInboxMsgsLoading(false);
      setTimeout(() => inboxBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }

  // ── Inbox audio recording ─────────────────────────────────────
  async function startInboxRecording() {
    if (inboxUploading || inboxReplying || !selectedInboxConv) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      inboxMediaRecorderRef.current = mediaRecorder;
      inboxAudioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) inboxAudioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const actualMime = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(inboxAudioChunksRef.current, { type: actualMime });
        const ext = actualMime.includes("ogg") ? "ogg" : actualMime.includes("mp4") ? "mp4" : "webm";
        await uploadInboxFile(blob, `audio.${ext}`);
      };
      mediaRecorder.start(250);
      setInboxIsRecording(true);
      setInboxRecordingDuration(0);
      inboxRecordingTimerRef.current = setInterval(() => setInboxRecordingDuration((d) => d + 1), 1000);
    } catch { /* microphone access denied */ }
  }

  function stopInboxRecording() {
    if (inboxMediaRecorderRef.current && inboxIsRecording) {
      inboxMediaRecorderRef.current.stop();
      if (inboxRecordingTimerRef.current) { clearInterval(inboxRecordingTimerRef.current); inboxRecordingTimerRef.current = null; }
      setInboxIsRecording(false);
      setInboxRecordingDuration(0);
    }
  }

  // ── Inbox file / audio upload ─────────────────────────────────
  async function uploadInboxFile(fileOrBlob: File | Blob, filename?: string) {
    if (!selectedInboxConv) return;
    setInboxUploading(true);
    try {
      const form = new FormData();
      form.append("password", password);
      form.append("file", fileOrBlob, filename ?? (fileOrBlob as File).name);
      const res = await fetch(`/api/admin/broadcast-inbox/${selectedInboxConv.id}/upload`, { method: "POST", body: form });
      if (!res.ok) { toast({ title: "Erreur", description: "Impossible d'envoyer le fichier.", variant: "destructive" }); return; }
      const data = await res.json() as { message: InboxMessage };
      setInboxMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
      setInboxConvs((prev) => prev.map((c) => c.id === selectedInboxConv.id
        ? { ...c, updatedAt: new Date().toISOString(), lastMessage: null, lastSenderType: "buyer" } : c)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      setTimeout(() => inboxBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } finally { setInboxUploading(false); }
  }

  async function handleInboxFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) { toast({ title: "Format non supporté", description: "Utilisez JPEG, PNG ou PDF.", variant: "destructive" }); return; }
    await uploadInboxFile(file);
  }

  async function editInboxMessage() {
    if (!selectedInboxConv || !inboxEditingId || !inboxEditContent.trim()) return;
    try {
      const res = await fetch(`/api/admin/broadcast-inbox/${selectedInboxConv.id}/messages/${inboxEditingId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, content: inboxEditContent.trim() }),
      });
      if (!res.ok) { toast({ title: "Erreur", description: "Impossible de modifier le message.", variant: "destructive" }); return; }
      const data = await res.json() as { content: string; editedAt: string };
      setInboxMessages((prev) => prev.map((m) => m.id === inboxEditingId ? { ...m, content: data.content, editedAt: data.editedAt } : m));
    } finally {
      setInboxEditingId(null);
      setInboxEditContent("");
    }
  }

  async function deleteInboxMessage(msgId: number) {
    if (!selectedInboxConv) return;
    setInboxMenuMsgId(null);
    setInboxMenuPos(null);
    const res = await fetch(`/api/admin/broadcast-inbox/${selectedInboxConv.id}/messages/${msgId}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) { toast({ title: "Erreur", description: "Impossible de supprimer le message.", variant: "destructive" }); return; }
    setInboxMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, deletedAt: new Date().toISOString() } : m));
  }

  async function sendInboxReply() {
    if (!selectedInboxConv || !inboxReply.trim()) return;
    setInboxReplying(true);
    try {
      const res = await fetch(`/api/admin/broadcast-inbox/${selectedInboxConv.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, content: inboxReply.trim() }),
      });
      if (!res.ok) { toast({ title: "Erreur", description: "Impossible d'envoyer le message.", variant: "destructive" }); return; }
      const data = await res.json() as { message: InboxMessage };
      setInboxMessages(prev => [...prev, data.message]);
      setInboxReply("");
      // Update conversation list
      setInboxConvs(prev => prev.map(c => c.id === selectedInboxConv.id
        ? { ...c, updatedAt: new Date().toISOString(), lastMessage: inboxReply.trim(), lastSenderType: "buyer" }
        : c
      ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      setTimeout(() => inboxBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } finally {
      setInboxReplying(false);
    }
  }

  useEffect(() => {
    if (tab === "inbox" && inboxConvs.length === 0 && !inboxLoading) {
      loadInbox();
    }
  }, [tab]);

  // ── Bouton ← Android dans la vue thread inbox ─────────────────
  // Quand l'admin ouvre un thread, openInboxConv() pousse une entrée
  // d'historique. Ce listener intercepte le popstate et revient à la
  // liste au lieu de quitter le panneau admin.
  useEffect(() => {
    if (!selectedInboxConv) return;
    const handlePopState = () => {
      setSelectedInboxConv(null);
      setInboxMessages([]);
      setInboxMenuMsgId(null);
      setInboxMenuPos(null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedInboxConv]);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsDateFrom, setStatsDateFrom] = useState("");
  const [statsDateTo, setStatsDateTo] = useState("");

  const [pendingListings, setPendingListings] = useState<NonNullable<ReturnType<typeof useAdminGetPendingListings>["data"]>>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  type PendingListing = NonNullable<ReturnType<typeof useAdminGetPendingListings>["data"]>[number];
  const [selectedPendingListing, setSelectedPendingListing] = useState<PendingListing | null>(null);

  const [vendors, setVendors] = useState<VendorProfile[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [contactStats, setContactStats] = useState<AdminContactStat[]>([]);

  const [allAds, setAllAds] = useState<Ad[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [showAdForm, setShowAdForm] = useState(false);
  const [playingAdId, setPlayingAdId] = useState<number | null>(null);
  const [adForm, setAdForm] = useState({ advertiserName: "", advertiserPhone: "", videoPath: "", videoName: "" });
  const adVideoRef = useRef<HTMLInputElement>(null);

  const [allEvents, setAllEvents] = useState<ApiEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [eventForm, setEventForm] = useState({ title: "", description: "", date: "", location: "", ticketPrice: "", ticketLink: "", flyerImage: "", flyerPreview: "", videoPath: "", videoName: "" });
  const eventFlyerRef = useRef<HTMLInputElement>(null);
  const eventVideoRef = useRef<HTMLInputElement>(null);

  const [allServices, setAllServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceForm, setServiceForm] = useState({ type: "offer" as "offer" | "seeker" | "atelier", title: "", description: "", contact: "", quartier: "", ville: "", image: "", imagePreview: "", videoPath: "", videoName: "" });
  const serviceImageRef = useRef<HTMLInputElement>(null);
  const serviceVideoRef = useRef<HTMLInputElement>(null);

  const [vendorWhatsappLoading, setVendorWhatsappLoading] = useState<number | null>(null);
  const [expandedVendorId, setExpandedVendorId] = useState<number | null>(null);
  const [resetPwdVendor, setResetPwdVendor] = useState<{ id: number; phone: string; name: string } | null>(null);
  const [resetPwdInput, setResetPwdInput] = useState("");

  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [showNewAccountForm, setShowNewAccountForm] = useState(false);
  const [newAccount, setNewAccount] = useState({ username: "", role: "admin_pub", code: "" });

  const [confirm30Vendor, setConfirm30Vendor] = useState<{ id: number; name: string } | null>(null);
  const [confirm30Loading, setConfirm30Loading] = useState(false);
  const [confirmPublishItem, setConfirmPublishItem] = useState<{ type: "ad" | "event" | "service"; id: number; title: string } | null>(null);
  const [confirmPublishLoading, setConfirmPublishLoading] = useState(false);

  const [paymentLinkDialog, setPaymentLinkDialog] = useState<{
    entityType: "ad" | "event" | "service";
    entityId: number;
    customerName: string;
    customerPhone: string;
  } | null>(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);

  const [settingsForm, setSettingsForm] = useState({
    whatsappCommission: "",
    whatsappOrders: "",
    whatsappAds: "",
    whatsappServices: "",
    commissionRate: "5",
    subAdminPwd: "",
  });

  const pendingMutation = useAdminGetPendingListings();
  const approveListing = useAdminApproveListing();
  const deleteListing = useAdminDeleteListing();
  const getVendors = useAdminGetVendors();
  const activateVendor = useAdminActivateVendor();

  const deleteVendor = useAdminDeleteVendor();
  const resetVendorPassword = useAdminResetVendorPassword();
  const createAd = useAdminCreateAd();
  const getAllAds = useAdminGetAllAds();
  const deleteAd = useAdminDeleteAd();
  const createEvent = useAdminCreateEvent();
  const deleteEvent = useAdminDeleteEvent();
  const getEventsQuery = useGetEvents();
  const getContactStats = useGetAdminContactStats();
  const createService = useAdminCreateService();
  const getAllServicesQuery = useAdminGetAllServices();
  const deleteService = useAdminDeleteService();
  const storageCleanup = useAdminStorageCleanup();
  const updateSettings = useUpdateAdminSettings();
  const { data: settingsData, refetch: refetchSettings } = useGetAdminSettings();

  useEffect(() => {
    if (settingsData) {
      setSettingsForm((f) => ({
        ...f,
        whatsappCommission: settingsData.whatsappCommission ?? "",
        whatsappOrders: settingsData.whatsappOrders ?? "",
        whatsappAds: settingsData.whatsappAds ?? "",
        whatsappServices: settingsData.whatsappServices ?? "",
        commissionRate: String(settingsData.commissionRate ?? 5),
      }));
    }
  }, [settingsData]);

  const loadStats = (from?: string, to?: string) => {
    setStatsLoading(true);
    const dateFrom = from !== undefined ? from : statsDateFrom;
    const dateTo = to !== undefined ? to : statsDateTo;
    fetch("/api/admin/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: password, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    })
      .then((r) => r.json())
      .then((d) => { setStats(d); setStatsLoading(false); })
      .catch(() => setStatsLoading(false));
  };

  const applyQuickRange = (preset: "today" | "week" | "month" | "year" | "all") => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = fmt(now);
    if (preset === "today") {
      setStatsDateFrom(today); setStatsDateTo(today); loadStats(today, today);
    } else if (preset === "week") {
      const start = new Date(now); start.setDate(now.getDate() - now.getDay() + 1);
      const from = fmt(start); setStatsDateFrom(from); setStatsDateTo(today); loadStats(from, today);
    } else if (preset === "month") {
      const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      setStatsDateFrom(from); setStatsDateTo(today); loadStats(from, today);
    } else if (preset === "year") {
      const from = `${now.getFullYear()}-01-01`;
      setStatsDateFrom(from); setStatsDateTo(today); loadStats(from, today);
    } else {
      setStatsDateFrom(""); setStatsDateTo(""); loadStats("", "");
    }
  };

  const loadPending = () => {
    setPendingLoading(true);
    pendingMutation.mutate(
      { data: { password } },
      {
        onSuccess: (d) => { setPendingListings(d); setPendingLoading(false); },
        onError: () => setPendingLoading(false),
      }
    );
  };

  const loadVendors = () => {
    setVendorsLoading(true);
    getVendors.mutate(
      { data: { password } },
      {
        onSuccess: (d) => { setVendors(d); setVendorsLoading(false); },
        onError: () => setVendorsLoading(false),
      }
    );
    getContactStats.mutate(
      { data: { password } },
      { onSuccess: (d) => setContactStats(d) }
    );
  };

  const loadAds = () => {
    setAdsLoading(true);
    getAllAds.mutate(
      { data: { password } },
      {
        onSuccess: (d) => { setAllAds(d); setAdsLoading(false); },
        onError: () => setAdsLoading(false),
      }
    );
  };

  const loadEvents = () => {
    setEventsLoading(true);
    fetch("/api/admin/events/all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
      .then((r) => r.json())
      .then((d) => { setAllEvents(Array.isArray(d) ? d : []); setEventsLoading(false); })
      .catch(() => setEventsLoading(false));
  };

  const loadServices = () => {
    setServicesLoading(true);
    getAllServicesQuery.mutate(
      { data: { password } },
      {
        onSuccess: (d) => { setAllServices(d); setServicesLoading(false); },
        onError: () => setServicesLoading(false),
      }
    );
  };

  const loadAccounts = () => {
    setAccountsLoading(true);
    fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: password }),
    })
      .then((r) => r.json())
      .then((d) => { setAccounts(Array.isArray(d) ? d : []); setAccountsLoading(false); })
      .catch(() => setAccountsLoading(false));
  };

  useEffect(() => {
    if (isSuperAdmin) {
      loadStats();
      loadPending();
    } else {
      if (session.role === "admin_pub") loadAds();
      else if (session.role === "admin_event") loadEvents();
      else if (session.role === "admin_service") loadServices();
      else if (session.role === "admin_stats") loadStats();
    }
  }, []);

  const handleTabChange = (t: DashTab) => {
    setTab(t);
    if (t === "stats") loadStats();
    if (t === "pending") loadPending();
    if (t === "vendors") loadVendors();
    if (t === "ads") loadAds();
    if (t === "events") loadEvents();
    if (t === "services") loadServices();
    if (t === "accounts") loadAccounts();
    if (t === "inbox") loadInbox();
  };

  const handleApprove = (id: number) => {
    approveListing.mutate(
      { data: { password, id } },
      {
        onSuccess: () => {
          toast({ title: "Annonce approuvée !" });
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          loadPending();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteListing = (id: number) => {
    deleteListing.mutate(
      { data: { password, id } },
      {
        onSuccess: () => {
          toast({ title: "Annonce supprimée" });
          queryClient.invalidateQueries({ queryKey: getGetListingsQueryKey() });
          loadPending();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleActivateVendor = (vendorId: number) => {
    activateVendor.mutate(
      { data: { password, vendorId } },
      {
        onSuccess: () => {
          toast({ title: "Vendeur activé" });
          loadVendors();
        },
        onError: () => toast({ title: "Erreur lors de l'activation", variant: "destructive" }),
      }
    );
  };

  const handleDeleteVendor = (vendorId: number) => {
    deleteVendor.mutate(
      { data: { password, vendorId } },
      {
        onSuccess: () => {
          toast({ title: "Vendeur supprimé" });
          loadVendors();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleResetPassword = (vendorPhone: string, newPassword: string) => {
    if (newPassword.length < 6) { toast({ title: "Minimum 6 caractères", variant: "destructive" }); return; }
    resetVendorPassword.mutate(
      { data: { password, vendorPhone, newPassword } },
      {
        onSuccess: () => {
          toast({ title: "Mot de passe réinitialisé" });
          setResetPwdVendor(null);
          setResetPwdInput("");
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleForcePublishVendor = () => {
    if (!confirm30Vendor) return;
    setConfirm30Loading(true);
    fetch("/api/admin/vendors/force-publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: password, vendorId: confirm30Vendor.id }),
    })
      .then((r) => r.json())
      .then(() => { toast({ title: "Boutique réactivée 30 jours" }); setConfirm30Vendor(null); loadVendors(); })
      .catch(() => toast({ title: "Erreur", variant: "destructive" }))
      .finally(() => setConfirm30Loading(false));
  };

  const handleForcePublishItem = () => {
    if (!confirmPublishItem) return;
    setConfirmPublishLoading(true);
    const endpoint = confirmPublishItem.type === "ad"
      ? "/api/admin/ads/force-publish"
      : confirmPublishItem.type === "event"
      ? "/api/admin/events/force-publish"
      : "/api/admin/services/force-publish";
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: password, id: confirmPublishItem.id }),
    })
      .then((r) => r.json())
      .then(() => {
        toast({ title: "Publié avec succès" });
        setConfirmPublishItem(null);
        if (confirmPublishItem.type === "ad") loadAds();
        else if (confirmPublishItem.type === "event") loadEvents();
        else loadServices();
      })
      .catch(() => toast({ title: "Erreur", variant: "destructive" }))
      .finally(() => setConfirmPublishLoading(false));
  };

  const handleVendorWhatsApp = async (vendorId: number, firstName: string, phone: string) => {
    setVendorWhatsappLoading(vendorId);
    try {
      const r = await fetch("/api/fedapay/create-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "vendor",
          entityId: vendorId,
          customerName: firstName,
          customerPhone: phone,
        }),
      });
      const data = await r.json() as { widgetUrl?: string; error?: string };
      if (!r.ok || !data.widgetUrl) {
        toast({ title: "Erreur génération lien", description: data.error ?? "Impossible de créer le lien", variant: "destructive" });
        return;
      }
      const msg = `Bonjour ${firstName} ! 👋\n\nVotre abonnement TogoMarket arrive à expiration.\n\nRenouvelez facilement en ligne pour 1 000 FCFA/mois :\n${data.widgetUrl}\n\nMerci de votre confiance !`;
      openWhatsApp(`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`);
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setVendorWhatsappLoading(null);
    }
  };

  // Envoie un lien de renouvellement WhatsApp (URL stable qui crée la transaction FedaPay au clic)
  const handleSendRenewalWhatsApp = (
    entityType: "ad" | "event" | "service",
    entityId: number,
    name: string,
    phone: string,
  ) => {
    const renewalUrl = `https://togomarket.site/api/${entityType}s/renewal-link/${entityId}`;
    const entityLabel = entityType === "ad" ? "publicité" : entityType === "event" ? "événement" : "service";
    const msg = `Bonjour ${name} ! 👋\n\nVotre ${entityLabel} TogoMarket a expiré.\n\nRenouvelez facilement pour 1 000 FCFA/mois en cliquant sur ce lien :\n${renewalUrl}\n\nMerci de votre confiance ! 🙏`;
    const waPhone = phone.replace(/\D/g, "");
    if (waPhone.length >= 8) {
      openWhatsApp(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`);
    } else {
      // Pas de numéro valide : copie le lien dans le presse-papier et notifie
      navigator.clipboard.writeText(renewalUrl).catch(() => {});
      toast({ title: "Lien copié", description: "Partagez ce lien au propriétaire : " + renewalUrl });
    }
  };

  const handleSendPaymentLink = async () => {
    if (!paymentLinkDialog) return;
    setPaymentLinkLoading(true);
    try {
      const res = await fetch("/api/fedapay/create-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: paymentLinkDialog.entityType,
          entityId: paymentLinkDialog.entityId,
          customerName: paymentLinkDialog.customerName,
          customerPhone: paymentLinkDialog.customerPhone,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: "Erreur", description: err.error ?? "Impossible de créer le lien de paiement", variant: "destructive" });
        return;
      }
      const data = await res.json() as { widgetUrl?: string };
      const link = data.widgetUrl ?? "";
      if (!link) {
        toast({ title: "Erreur", description: "Lien de paiement introuvable dans la réponse", variant: "destructive" });
        return;
      }
      const msg = `Bonjour ${paymentLinkDialog.customerName},\n\nVoici votre lien de paiement TogoMarket (1 000 FCFA) :\n${link}\n\nMerci de procéder au paiement pour valider votre annonce sur TogoMarket.`;
      openWhatsApp(`https://wa.me/${paymentLinkDialog.customerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`);
      setPaymentLinkDialog(null);
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setPaymentLinkLoading(false);
    }
  };


  const [adVideoStatus, setAdVideoStatus] = useState<"idle" | "compressing" | "uploading">("idle");
  const handleAdVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setAdVideoStatus("uploading");
    try {
      const objectPath = await uploadVideoFile(file, (s) => setAdVideoStatus(s));
      setAdForm((f) => ({ ...f, videoPath: objectPath, videoName: file.name }));
    } catch {
      toast({ title: "Erreur vidéo", variant: "destructive" });
    } finally {
      setAdVideoStatus("idle");
    }
  };

  const handleCreateAd = () => {
    if (!adForm.advertiserPhone.trim() || !adForm.videoPath) {
      toast({ title: "Vidéo et numéro WhatsApp requis", variant: "destructive" });
      return;
    }
    createAd.mutate(
      { data: { password, advertiserName: adForm.advertiserName || adForm.advertiserPhone, advertiserPhone: adForm.advertiserPhone, message: "", videoPath: adForm.videoPath } },
      {
        onSuccess: () => {
          toast({ title: "Publicité créée !" });
          setAdForm({ advertiserName: "", advertiserPhone: "", videoPath: "", videoName: "" });
          setShowAdForm(false);
          loadAds();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const pinAd = useAdminPinAd();

  const handleDeleteAd = (id: number) => {
    deleteAd.mutate(
      { data: { id, password } },
      {
        onSuccess: () => { toast({ title: "Publicité supprimée" }); loadAds(); },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handlePinAd = (id: number) => {
    pinAd.mutate(
      { data: { id, password } },
      {
        onSuccess: (ad) => {
          toast({ title: ad.isPinned ? "Publicité épinglée 📌" : "Publicité désépinglée" });
          loadAds();
        },
        onError: (err: Error) => toast({ title: err?.message ?? "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleEventFlyerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { blob, dataUrl } = await resizeImageToBlob(file);
      const objectPath = await uploadImageFile(blob, file.name);
      setEventForm((f) => ({ ...f, flyerImage: objectPath, flyerPreview: dataUrl }));
    } catch {
      toast({ title: "Impossible de lire l'image", variant: "destructive" });
    }
  };

  const [eventVideoStatus, setEventVideoStatus] = useState<"idle" | "compressing" | "uploading">("idle");
  const handleEventVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setEventVideoStatus("uploading");
    try {
      const objectPath = await uploadVideoFile(file, (s) => setEventVideoStatus(s));
      setEventForm((f) => ({ ...f, videoPath: objectPath, videoName: file.name }));
    } catch {
      toast({ title: "Erreur vidéo", variant: "destructive" });
    } finally {
      setEventVideoStatus("idle");
    }
  };

  const handleCreateEvent = () => {
    if (!eventForm.title || !eventForm.description || !eventForm.date || !eventForm.location) {
      toast({ title: "Titre, description, date et lieu sont requis", variant: "destructive" });
      return;
    }
    createEvent.mutate(
      {
        data: {
          password,
          title: eventForm.title,
          description: eventForm.description,
          date: eventForm.date,
          location: eventForm.location,
          ticketPrice: eventForm.ticketPrice || undefined,
          ticketLink: eventForm.ticketLink || undefined,
          flyerImage: eventForm.flyerImage || undefined,
          videoPath: eventForm.videoPath || undefined,
        }
      },
      {
        onSuccess: () => {
          toast({ title: "Événement créé !" });
          setShowEventForm(false);
          setEventForm({ title: "", description: "", date: "", location: "", ticketPrice: "", ticketLink: "", flyerImage: "", flyerPreview: "", videoPath: "", videoName: "" });
          queryClient.invalidateQueries({ queryKey: getGetEventsQueryKey() });
          loadEvents();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteEvent = (id: number) => {
    deleteEvent.mutate(
      { data: { password, id } },
      {
        onSuccess: () => {
          toast({ title: "Événement supprimé" });
          queryClient.invalidateQueries({ queryKey: getGetEventsQueryKey() });
          loadEvents();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleServiceImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { blob, dataUrl } = await resizeImageToBlob(file);
      const objectPath = await uploadImageFile(blob, file.name);
      setServiceForm((f) => ({ ...f, image: objectPath, imagePreview: dataUrl }));
    } catch {
      toast({ title: "Erreur image", variant: "destructive" });
    }
  };

  const [serviceVideoStatus, setServiceVideoStatus] = useState<"idle" | "compressing" | "uploading">("idle");
  const handleServiceVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setServiceVideoStatus("uploading");
    try {
      const objectPath = await uploadVideoFile(file, (s) => setServiceVideoStatus(s));
      setServiceForm((f) => ({ ...f, videoPath: objectPath, videoName: file.name }));
    } catch {
      toast({ title: "Erreur vidéo", variant: "destructive" });
    } finally {
      setServiceVideoStatus("idle");
    }
  };

  const handleCreateService = () => {
    if (!serviceForm.title || !serviceForm.description || !serviceForm.contact) {
      toast({ title: "Titre, description et contact requis", variant: "destructive" });
      return;
    }
    createService.mutate(
      {
        data: {
          password,
          type: serviceForm.type,
          title: serviceForm.title,
          description: serviceForm.description,
          contact: serviceForm.contact,
          quartier: serviceForm.quartier,
          ville: serviceForm.ville,
          image: serviceForm.image || undefined,
          videoPath: serviceForm.videoPath || undefined,
        }
      },
      {
        onSuccess: () => {
          toast({ title: "Service créé !" });
          setShowServiceForm(false);
          setServiceForm({ type: "offer", title: "", description: "", contact: "", quartier: "", ville: "", image: "", imagePreview: "", videoPath: "", videoName: "" });
          queryClient.invalidateQueries({ queryKey: getGetServicesQueryKey() });
          loadServices();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleDeleteService = (id: number) => {
    deleteService.mutate(
      { data: { id, password } },
      {
        onSuccess: () => {
          toast({ title: "Service supprimé" });
          queryClient.invalidateQueries({ queryKey: getGetServicesQueryKey() });
          loadServices();
        },
        onError: () => toast({ title: "Erreur", variant: "destructive" }),
      }
    );
  };

  const handleSaveSettings = () => {
    updateSettings.mutate(
      {
        data: {
          password,
          commissionRate: parseFloat(settingsForm.commissionRate),
          whatsappCommission: settingsForm.whatsappCommission,
          whatsappOrders: settingsForm.whatsappOrders,
          whatsappAds: settingsForm.whatsappAds || undefined,
          whatsappServices: settingsForm.whatsappServices || undefined,
          subAdminPassword: settingsForm.subAdminPwd || undefined,
        }
      },
      {
        onSuccess: () => {
          toast({ title: "Paramètres sauvegardés !" });
          refetchSettings();
          queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
        },
        onError: () => toast({ title: "Erreur lors de la sauvegarde", variant: "destructive" }),
      }
    );
  };

  const handleCreateAccount = async () => {
    if (!newAccount.username.trim() || !newAccount.code.trim()) {
      toast({ title: "Nom et code requis", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/admin/accounts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: password, username: newAccount.username, role: newAccount.role, newCode: newAccount.code }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Compte créé !" });
      setNewAccount({ username: "", role: "admin_pub", code: "" });
      setShowNewAccountForm(false);
      loadAccounts();
    } catch {
      toast({ title: "Erreur lors de la création", variant: "destructive" });
    }
  };

  const handleDeleteAccount = async (accountId: number) => {
    try {
      const res = await fetch("/api/admin/accounts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: password, accountId }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Compte supprimé" });
      loadAccounts();
    } catch {
      toast({ title: "Erreur", variant: "destructive" });
    }
  };

  const handleLogout = () => {
    clearAdminSession();
    navigate("/");
  };

  const filteredVendors = vendors.filter((v) => {
    if (!vendorSearch.trim()) return true;
    const q = vendorSearch.toLowerCase();
    return (
      v.firstName.toLowerCase().includes(q) ||
      v.lastName.toLowerCase().includes(q) ||
      v.phone.includes(q) ||
      String(v.id).includes(q)
    );
  });

  const role = session?.role ?? "";

  const tabs: Array<{ key: DashTab; label: string; icon: React.ReactNode; roles?: string[] }> = [
    { key: "stats", label: "Statistiques", icon: <LayoutDashboard className="w-4 h-4" />, roles: ["superadmin", "admin_stats", "admin_pub", "admin_event", "admin_service"] },
    { key: "pending", label: "En attente", icon: <Clock className="w-4 h-4" />, roles: ["superadmin"] },
    { key: "vendors", label: "Vendeurs", icon: <Users className="w-4 h-4" />, roles: ["superadmin"] },
    { key: "ads", label: "Publicités", icon: <Megaphone className="w-4 h-4" />, roles: ["superadmin", "admin_pub"] },
    { key: "events", label: "Événements", icon: <Calendar className="w-4 h-4" />, roles: ["superadmin", "admin_event"] },
    { key: "services", label: "Services", icon: <Briefcase className="w-4 h-4" />, roles: ["superadmin", "admin_service"] },
    { key: "settings", label: "Paramètres", icon: <Settings className="w-4 h-4" />, roles: ["superadmin"] },
    { key: "accounts", label: "Comptes", icon: <Shield className="w-4 h-4" />, roles: ["superadmin"] },
    { key: "inbox", label: "Messages", icon: <MessageSquare className="w-4 h-4" />, roles: ["superadmin"] },
  ];

  const visibleTabs = tabs.filter((t) => !t.roles || t.roles.includes(role));

  return (
    <div className="min-h-[100dvh] flex flex-col bg-muted/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-bold text-sm leading-none">Administration</p>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">
                {session.role === "superadmin" ? "Superadmin" : "Admin"} — {session.code.length > 3 ? "●".repeat(session.code.length) : "●●●●"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/")} className="text-xs h-8">
              Marketplace
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs h-8 text-destructive hover:text-destructive">
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Déconnexion
            </Button>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-4 overflow-x-auto">
          <div className="flex gap-0.5 pb-0 min-w-max">
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon}
                {t.label}
                {t.key === "pending" && pendingListings.length > 0 && (
                  <span className="ml-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {pendingListings.length}
                  </span>
                )}
                {t.key === "inbox" && totalInboxUnread > 0 && (
                  <span className="ml-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {totalInboxUnread}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 space-y-6">

        {/* ── STATISTIQUES ─────────────────────────────────────── */}
        {tab === "stats" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Vue d'ensemble</h2>
              <Button variant="outline" size="sm" onClick={() => loadStats()} disabled={statsLoading}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${statsLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
            </div>

            {/* ── FILTRE PAR PÉRIODE ── */}
            <div className="bg-card border rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filtrer par période</p>
              <div className="flex flex-wrap gap-2">
                {(["today", "week", "month", "year", "all"] as const).map((preset) => {
                  const labels = { today: "Aujourd'hui", week: "Cette semaine", month: "Ce mois", year: "Cette année", all: "Tout afficher" };
                  return (
                    <button
                      key={preset}
                      onClick={() => applyQuickRange(preset)}
                      className="px-3 py-1.5 text-xs rounded-full border font-medium transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary"
                    >
                      {labels[preset]}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">Du</label>
                  <input
                    type="date"
                    value={statsDateFrom}
                    onChange={(e) => setStatsDateFrom(e.target.value)}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs text-muted-foreground">Au</label>
                  <input
                    type="date"
                    value={statsDateTo}
                    onChange={(e) => setStatsDateTo(e.target.value)}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
                <Button size="sm" onClick={() => loadStats()} disabled={statsLoading} className="shrink-0">
                  Appliquer
                </Button>
              </div>
              {(statsDateFrom || statsDateTo) && (
                <p className="text-xs text-muted-foreground">
                  Période sélectionnée : {statsDateFrom ? new Date(statsDateFrom).toLocaleDateString("fr-FR") : "…"} → {statsDateTo ? new Date(statsDateTo).toLocaleDateString("fr-FR") : "…"}
                </p>
              )}
            </div>
            {stats ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="Vendeurs total" value={stats.vendors.total} sub={`${stats.vendors.paid} via FedaPay`} color="text-primary" />
                  <StatCard label="Via FedaPay" value={stats.vendors.paid} sub="paiement confirmé" />
                  <StatCard label="Validés admin" value={stats.vendors.admin} sub="par l'admin" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="Publicités total" value={stats.ads.total} sub={`${stats.ads.paid} via FedaPay`} color="text-primary" />
                  <StatCard label="Via FedaPay" value={stats.ads.paid} sub="paiement confirmé" />
                  <StatCard label="Via Admin" value={stats.ads.admin} sub="ajouté par l'admin" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="Événements total" value={stats.events.total} sub={`${stats.events.paid} via FedaPay`} color="text-primary" />
                  <StatCard label="Via FedaPay" value={stats.events.paid} sub="paiement confirmé" />
                  <StatCard label="Via Admin" value={stats.events.admin} sub="ajouté par l'admin" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="Services total" value={stats.services.total} sub={`${stats.services.paid} via FedaPay`} color="text-primary" />
                  <StatCard label="Via FedaPay" value={stats.services.paid} sub="paiement confirmé" />
                  <StatCard label="Via Admin" value={stats.services.admin} sub="ajouté par l'admin" />
                </div>
                {stats.expiringSoon.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" />
                      {stats.expiringSoon.length} boutique(s) expirent dans 3 jours
                    </h3>
                    <div className="space-y-2">
                      {stats.expiringSoon.map((v) => (
                        <div key={v.id} className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2 border border-amber-100">
                          <span className="font-medium">{v.firstName} {v.lastName}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{v.phone}</span>
                            <button
                              onClick={() => openWhatsApp(`https://wa.me/${v.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Bonjour ${v.firstName}, votre abonnement TogoMarket expire bientôt. Renouvelez pour 1 000 FCFA.`)}`)}
                              className="text-xs bg-green-500 text-white rounded-full px-2 py-0.5 hover:bg-green-600"
                            >
                              WhatsApp
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="bg-card border rounded-xl p-4">
                  <h3 className="text-sm font-semibold mb-3">Nettoyage du stockage</h3>
                  <p className="text-xs text-muted-foreground mb-3">Supprime les fichiers images orphelins non liés à une annonce.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => {
                      storageCleanup.mutate(
                        { data: { password } },
                        {
                          onSuccess: (r) => toast({ title: "Nettoyage terminé", description: `${r.deleted} fichier(s) supprimé(s).` }),
                          onError: () => toast({ title: "Erreur lors du nettoyage", variant: "destructive" }),
                        }
                      );
                    }}
                    disabled={storageCleanup.isPending}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-2 ${storageCleanup.isPending ? "animate-spin" : ""}`} />
                    {storageCleanup.isPending ? "Nettoyage en cours…" : "Nettoyer les orphelins"}
                  </Button>
                </div>
              </>
            ) : statsLoading ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-10">Cliquez sur Actualiser pour charger les stats.</p>
            )}
          </div>
        )}

        {/* ── ANNONCES EN ATTENTE ───────────────────────────────── */}
        {tab === "pending" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Annonces en attente ({pendingListings.length})</h2>
              <Button variant="outline" size="sm" onClick={loadPending} disabled={pendingLoading}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${pendingLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
            </div>
            {pendingLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : pendingListings.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-50" />
                <p className="font-medium">Aucune annonce en attente</p>
              </div>
            ) : (
              <>
              <div className="space-y-3">
                {pendingListings.map((listing) => (
                  <div
                    key={listing.id}
                    className="bg-card border rounded-xl p-4 space-y-3 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
                    onClick={() => setSelectedPendingListing(listing)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-semibold truncate">{listing.name}</p>
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        </div>
                        <p className="text-sm text-muted-foreground">{listing.price.toLocaleString("fr-FR")} FCFA · {listing.sector} · {listing.location}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <Phone className="w-3 h-3 inline mr-1" />
                          {listing.phone}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" className="h-8 bg-green-600 hover:bg-green-700" onClick={() => handleApprove(listing.id)}>
                          <CheckCircle className="w-3.5 h-3.5 mr-1" />
                          Approuver
                        </Button>
                        <Button size="sm" variant="destructive" className="h-8" onClick={() => handleDeleteListing(listing.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {listing.images && listing.images.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
                        {listing.images.map((img, i) => (
                          <AdminMediaThumb
                            key={i}
                            path={img}
                            onClick={() => { setViewerImages(listing.images.filter(p => !isVideoMedia(p) && !p.startsWith("v:"))); setViewerIndex(0); }}
                            onVideoClick={(url) => setVideoPlayerUrl(url)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── MODAL DÉTAIL ANNONCE EN ATTENTE ── */}
              <Dialog open={!!selectedPendingListing} onOpenChange={(o) => { if (!o) setSelectedPendingListing(null); }}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
                  {/* Images */}
                  {selectedPendingListing?.images && selectedPendingListing.images.length > 0 && (
                    <div className="relative">
                      <div className="flex overflow-x-auto snap-x snap-mandatory">
                        {selectedPendingListing.images.map((img, i) => (
                          <AdminMediaSlide
                            key={i}
                            path={img}
                            onClick={() => { setViewerImages(selectedPendingListing.images); setViewerIndex(i); }}
                          />
                        ))}
                      </div>
                      {selectedPendingListing.images.length > 1 && (
                        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                          {selectedPendingListing.images.map((_, i) => (
                            <span key={i} className="w-1.5 h-1.5 rounded-full bg-white/70" />
                          ))}
                        </div>
                      )}
                      <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                        {selectedPendingListing.images.length} photo{selectedPendingListing.images.length > 1 ? "s" : ""}
                      </div>
                    </div>
                  )}

                  <div className="p-5 space-y-4">
                    <DialogHeader>
                      <DialogTitle className="text-xl leading-tight">{selectedPendingListing?.name}</DialogTitle>
                    </DialogHeader>

                    {/* Prix */}
                    <p className="text-2xl font-bold text-primary">
                      {selectedPendingListing?.price.toLocaleString("fr-FR")} FCFA
                    </p>

                    {/* Détails en grille */}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Tag className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                        <div>
                          <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground/70">Secteur</p>
                          <p className="font-semibold">{selectedPendingListing?.sector}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                        <div>
                          <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground/70">Localisation</p>
                          <p className="font-semibold">
                            {selectedPendingListing?.location}
                            {selectedPendingListing?.country && selectedPendingListing.country !== "Togo" ? ` — ${selectedPendingListing.country}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Phone className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                        <div>
                          <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground/70">Téléphone vendeur</p>
                          <p className="font-semibold">{selectedPendingListing?.phone}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Clock3 className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                        <div>
                          <p className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground/70">Soumise le</p>
                          <p className="font-semibold">
                            {selectedPendingListing && new Date(selectedPendingListing.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      <span className="bg-muted px-2 py-0.5 rounded-full">ID #{selectedPendingListing?.id}</span>
                    </div>

                    {/* Actions */}
                    <DialogFooter className="flex gap-2 pt-2 sm:flex-row flex-col">
                      <Button
                        variant="destructive"
                        className="flex-1"
                        onClick={() => { if (selectedPendingListing) { handleDeleteListing(selectedPendingListing.id); setSelectedPendingListing(null); } }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Supprimer
                      </Button>
                      <Button
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() => { if (selectedPendingListing) { handleApprove(selectedPendingListing.id); setSelectedPendingListing(null); } }}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Approuver
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
              </>
            )}
          </div>
        )}

        {/* ── BROADCAST DIALOG ─────────────────────────────────── */}
        <Dialog open={showBroadcast} onOpenChange={(o) => { setShowBroadcast(o); if (!o) { setBroadcastMsg(""); setBroadcastResult(null); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-primary" />
                Message à tous les vendeurs
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Ce message sera envoyé à <strong>tous les vendeurs vérifiés</strong> dans leur onglet Messages, sous le nom <strong>TogoMarket</strong>.
            </p>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 min-h-[120px]"
              placeholder="Rédigez votre message de diffusion ici…"
              value={broadcastMsg}
              onChange={(e) => { setBroadcastMsg(e.target.value); setBroadcastResult(null); }}
              maxLength={1000}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{broadcastMsg.length}/1000</span>
              {broadcastResult === "error" && (
                <p className="text-xs text-destructive font-medium">Erreur lors de l'envoi. Réessayez.</p>
              )}
              {broadcastResult !== null && broadcastResult !== "error" && (
                <p className="text-xs text-green-700 font-medium">
                  ✓ Envoyé à {broadcastResult.sent} vendeur{broadcastResult.sent > 1 ? "s" : ""}.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowBroadcast(false)}>Annuler</Button>
              <Button
                disabled={!broadcastMsg.trim() || broadcastLoading}
                onClick={async () => {
                  setBroadcastLoading(true);
                  setBroadcastResult(null);
                  try {
                    const res = await fetch("/api/admin/broadcast-message", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ password, message: broadcastMsg.trim() }),
                    });
                    if (!res.ok) { setBroadcastResult("error"); return; }
                    const data = await res.json() as { sent: number };
                    setBroadcastResult({ sent: data.sent });
                    setBroadcastMsg("");
                  } catch { setBroadcastResult("error"); }
                  finally { setBroadcastLoading(false); }
                }}
              >
                <Megaphone className="w-4 h-4 mr-1.5" />
                {broadcastLoading ? "Envoi…" : "Envoyer à tous"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── VENDEURS ─────────────────────────────────────────── */}
        {tab === "vendors" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Vendeurs ({vendors.length})</h2>
              <div className="flex items-center gap-2">
                {isSuperAdmin && (
                  <Button size="sm" onClick={() => { setBroadcastResult(null); setShowBroadcast(true); }}>
                    <Megaphone className="w-3.5 h-3.5 mr-1.5" />
                    Diffuser
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={loadVendors} disabled={vendorsLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${vendorsLoading ? "animate-spin" : ""}`} />
                  Actualiser
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Rechercher par nom, téléphone ou n° boutique…"
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
              />
            </div>
            {vendorsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : filteredVendors.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucun vendeur trouvé</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredVendors.map((v) => {
                  const stat = contactStats.find((s) => s.vendorPhone === v.phone);
                  const isExpanded = expandedVendorId === v.id;
                  const daysLeft = v.daysUntilExpiry ?? null;
                  const expired = daysLeft !== null && daysLeft <= 0;
                  const expiringSoon = daysLeft !== null && daysLeft > 0 && daysLeft <= 3;

                  return (
                    <div key={v.id} className={`bg-card border rounded-xl overflow-hidden ${expired ? "border-red-200 bg-red-50/30" : expiringSoon ? "border-amber-200 bg-amber-50/30" : ""}`}>
                      <button
                        className="w-full flex items-center justify-between gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
                        onClick={() => setExpandedVendorId(isExpanded ? null : v.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary font-bold text-sm">
                            {v.firstName.charAt(0)}{v.lastName.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm">
                              {v.firstName} {v.lastName}
                              <span className="text-muted-foreground font-normal text-xs ml-2">N°{v.id}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">{v.phone}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {expired && <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-medium">Expiré</span>}
                          {expiringSoon && <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">{daysLeft}j</span>}
                          {!expired && !expiringSoon && daysLeft !== null && (
                            <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-medium">{daysLeft}j</span>
                          )}
                          <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${v.isPublished ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {v.isPublished ? "Actif" : "Inactif"}
                          </span>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t px-3 pb-3 pt-3 space-y-3">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-muted-foreground">Statut paiement : </span><span className="font-medium">{v.paymentStatus ?? "—"}</span></div>
                            <div><span className="text-muted-foreground">Validation : </span><span className="font-medium">{v.validationMethod ?? "—"}</span></div>
                            <div><span className="text-muted-foreground">Expiration : </span><span className="font-medium">{v.expiryDate ? new Date(v.expiryDate).toLocaleDateString("fr-FR") : "—"}</span></div>
                            <div><span className="text-muted-foreground">Contacts débloqués : </span><span className="font-medium">{stat?.count ?? 0}</span></div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!v.verified && (
                              <Button size="sm" className="h-7 text-xs bg-primary hover:bg-primary/90" onClick={() => handleActivateVendor(v.id)}>
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Activer
                              </Button>
                            )}
                            {isSuperAdmin && (
                              <Button size="sm" variant="outline" className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => setConfirm30Vendor({ id: v.id, name: `${v.firstName} ${v.lastName}` })}>
                                <RefreshCw className="w-3 h-3 mr-1" />
                                +30 jours
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                              setResetPwdVendor({ id: v.id, phone: v.phone, name: `${v.firstName} ${v.lastName}` });
                              setResetPwdInput("");
                            }}>
                              <KeyRound className="w-3 h-3 mr-1" />
                              Réinit. mot de passe
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={vendorWhatsappLoading === v.id}
                              className={`h-7 text-xs ${
                                expired
                                  ? "border-red-400 text-red-600 hover:bg-red-50"
                                  : expiringSoon
                                  ? "border-amber-400 text-amber-700 hover:bg-amber-50"
                                  : "border-green-400 text-green-700 hover:bg-green-50"
                              }`}
                              onClick={() => handleVendorWhatsApp(v.id, v.firstName, v.phone)}
                            >
                              {vendorWhatsappLoading === v.id ? (
                                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                              ) : (
                                <Phone className="w-3 h-3 mr-1" />
                              )}
                              WhatsApp
                            </Button>
                            {isSuperAdmin && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs"
                                onClick={() => { if (confirm(`Supprimer définitivement ${v.firstName} ${v.lastName} ?`)) handleDeleteVendor(v.id); }}
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Supprimer
                              </Button>
                            )}
                          </div>
                          {resetPwdVendor?.id === v.id && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-semibold text-blue-800">Nouveau mot de passe pour {resetPwdVendor.name}</p>
                              <Input
                                className="h-8 text-sm"
                                placeholder="Min. 6 caractères"
                                value={resetPwdInput}
                                onChange={(e) => setResetPwdInput(e.target.value)}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" className="flex-1 h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                                  onClick={() => handleResetPassword(resetPwdVendor.phone, resetPwdInput)}
                                  disabled={resetPwdInput.length < 6 || resetVendorPassword.isPending}
                                >
                                  {resetVendorPassword.isPending ? "…" : "Confirmer"}
                                </Button>
                                <Button size="sm" variant="outline" className="flex-1 h-7 text-xs" onClick={() => { setResetPwdVendor(null); setResetPwdInput(""); }}>
                                  Annuler
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PUBLICITÉS ───────────────────────────────────────── */}
        {tab === "ads" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Publicités ({allAds.length})</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadAds} disabled={adsLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${adsLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={() => setShowAdForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nouvelle publicité
                </Button>
              </div>
            </div>
            {showAdForm && (
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Nouvelle publicité</h3>
                <Input
                  placeholder="Nom de l'entreprise (optionnel)"
                  value={adForm.advertiserName}
                  onChange={(e) => setAdForm((f) => ({ ...f, advertiserName: e.target.value }))}
                />
                <Input
                  placeholder="Numéro WhatsApp *"
                  value={adForm.advertiserPhone}
                  onChange={(e) => setAdForm((f) => ({ ...f, advertiserPhone: e.target.value }))}
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="file" accept="video/*" ref={adVideoRef} className="hidden" onChange={handleAdVideoChange} disabled={adVideoStatus !== "idle"} />
                  <Button variant="outline" size="sm" onClick={() => adVideoRef.current?.click()} disabled={adVideoStatus !== "idle"}>
                    {adVideoStatus === "compressing" ? "⏳ Compression..." : adVideoStatus === "uploading" ? "⬆️ Envoi..." : adForm.videoName ? "🎬 Vidéo ✓" : "🎬 Ajouter la vidéo *"}
                  </Button>
                  {adForm.videoName && <span className="text-xs text-muted-foreground truncate max-w-[160px]">✅ {adForm.videoName}</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateAd} disabled={createAd.isPending || adVideoStatus !== "idle"}>
                    {createAd.isPending ? "Création…" : "Créer"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAdForm(false)}>Annuler</Button>
                </div>
              </div>
            )}
            {adsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : allAds.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucune publicité</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allAds.map((ad) => {
                  const active = new Date(ad.endDate) > new Date();
                  return (
                    <div key={ad.id} className={`bg-card border rounded-xl p-3 flex flex-col gap-2 ${!active ? "border-red-200 bg-red-50/30" : ""}`}>
                      <div className="flex items-center gap-3">
                      {ad.videoPath && (
                        <button
                          type="button"
                          className="w-14 h-14 rounded-lg bg-black flex items-center justify-center flex-shrink-0 overflow-hidden relative group"
                          onClick={() => setPlayingAdId(playingAdId === ad.id ? null : ad.id)}
                          title={playingAdId === ad.id ? "Fermer" : "Lire la vidéo"}
                        >
                          <span className="text-2xl">🎬</span>
                          <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                            <span className="text-white text-xs font-bold">{playingAdId === ad.id ? "✕" : "▶"}</span>
                          </div>
                        </button>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-sm truncate">{ad.advertiserName}</p>
                          {!active && <span className="text-[10px] bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-semibold shrink-0">⏰ Expiré</span>}
                          {active && ad.isPublished && <span className="text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold shrink-0">Actif</span>}
                          {!ad.isPublished && active && <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5 font-semibold shrink-0">En attente</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">{ad.advertiserPhone}</p>
                        <p className="text-xs text-muted-foreground">
                          Exp. : {new Date(ad.endDate).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                        {!active && (
                          <Button size="sm" variant="outline" className="h-7 text-xs border-orange-400 text-orange-700 hover:bg-orange-50" onClick={() => handleSendRenewalWhatsApp("ad", ad.id, ad.advertiserName, ad.advertiserPhone)}>
                            🔄 Renouveler
                          </Button>
                        )}
                        {!ad.isPublished && active && (
                          <Button size="sm" variant="outline" className="h-7 text-xs border-green-400 text-green-700 hover:bg-green-50" onClick={() => setConfirmPublishItem({ type: "ad", id: ad.id, title: ad.advertiserName })}>
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Valider
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`h-8 w-8 p-0 ${ad.isPinned ? "text-red-500 hover:text-red-600" : "text-gray-300 hover:text-gray-400"}`}
                          title={ad.isPinned ? "Désépingler" : "Épingler (max 5 par catégorie)"}
                          onClick={() => handlePinAd(ad.id)}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-green-600" title="Envoyer lien de paiement initial" onClick={() => setPaymentLinkDialog({ entityType: "ad", entityId: ad.id, customerName: ad.advertiserName, customerPhone: ad.advertiserPhone })}>
                          📲
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => { if (confirm("Supprimer cette publicité ?")) handleDeleteAd(ad.id); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      </div>{/* fin ligne */}
                      {playingAdId === ad.id && ad.videoPath && (
                        <video
                          src={resolveImageUrl(ad.videoPath)}
                          controls
                          autoPlay
                          playsInline
                          className="w-full rounded-lg bg-black max-h-52 object-contain"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ÉVÉNEMENTS ───────────────────────────────────────── */}
        {tab === "events" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Événements ({allEvents.length})</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadEvents} disabled={eventsLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${eventsLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={() => setShowEventForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nouvel événement
                </Button>
              </div>
            </div>
            {showEventForm && (
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Nouvel événement</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Titre *" value={eventForm.title} onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value }))} />
                  <Input type="date" placeholder="Date *" value={eventForm.date} onChange={(e) => setEventForm((f) => ({ ...f, date: e.target.value }))} />
                  <Input placeholder="Lieu *" value={eventForm.location} onChange={(e) => setEventForm((f) => ({ ...f, location: e.target.value }))} />
                  <Input placeholder="Prix billet" value={eventForm.ticketPrice} onChange={(e) => setEventForm((f) => ({ ...f, ticketPrice: e.target.value }))} />
                  <Input placeholder="Lien billets" value={eventForm.ticketLink} onChange={(e) => setEventForm((f) => ({ ...f, ticketLink: e.target.value }))} className="col-span-2" />
                </div>
                <textarea
                  className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px] resize-none"
                  placeholder="Description *"
                  value={eventForm.description}
                  onChange={(e) => setEventForm((f) => ({ ...f, description: e.target.value }))}
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="file" accept="image/*" ref={eventFlyerRef} className="hidden" onChange={handleEventFlyerChange} />
                  <input type="file" accept="video/*" ref={eventVideoRef} className="hidden" onChange={handleEventVideoChange} disabled={eventVideoStatus !== "idle"} />
                  <Button variant="outline" size="sm" onClick={() => eventFlyerRef.current?.click()}>Flyer</Button>
                  <Button variant="outline" size="sm" onClick={() => eventVideoRef.current?.click()} disabled={eventVideoStatus !== "idle"}>
                    {eventVideoStatus === "compressing" ? "⏳ Compression..." : eventVideoStatus === "uploading" ? "⬆️ Envoi..." : eventForm.videoName ? "🎬 Vidéo ✓" : "🎬 Vidéo"}
                  </Button>
                  {eventForm.flyerPreview && <img src={eventForm.flyerPreview} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                  {eventForm.videoName && <span className="text-xs text-muted-foreground truncate max-w-[120px]">✅ {eventForm.videoName}</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateEvent} disabled={createEvent.isPending}>
                    {createEvent.isPending ? "Création…" : "Créer"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowEventForm(false)}>Annuler</Button>
                </div>
              </div>
            )}
            {eventsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : allEvents.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucun événement</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allEvents.map((ev) => (
                  <div key={ev.id} className="bg-card border rounded-xl p-3 flex items-center gap-3">
                    {(ev.flyerImage || ev.videoPath) && (
                      <div className="relative w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-black/10">
                        {ev.videoPath
                          ? <SmartVideo src={resolveImageUrl(ev.videoPath)} mode="thumbnail" className="w-full h-full" />
                          : <img src={resolveImageUrl(ev.flyerImage!)} alt="" className="w-full h-full object-cover" />}
                        {ev.flyerImage && ev.videoPath && (
                          <span className="absolute top-0.5 left-0.5 bg-black/60 rounded text-white text-[9px] px-1">🎬</span>
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-semibold text-sm truncate">{ev.title}</p>
                        {ev.isPublished
                          ? <span className="text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold shrink-0">Publié</span>
                          : <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5 font-semibold shrink-0">En attente</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">{ev.location} · {new Date(ev.date).toLocaleDateString("fr-FR")}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {!ev.isPublished && (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-green-400 text-green-700 hover:bg-green-50" onClick={() => setConfirmPublishItem({ type: "event", id: ev.id, title: ev.title })}>
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Valider
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-green-600" title="Envoyer lien de paiement" onClick={() => setPaymentLinkDialog({ entityType: "event", entityId: ev.id, customerName: ev.title, customerPhone: "" })}>
                        📲
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => { if (confirm("Supprimer cet événement ?")) handleDeleteEvent(ev.id); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SERVICES ─────────────────────────────────────────── */}
        {tab === "services" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Services ({allServices.length})</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadServices} disabled={servicesLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${servicesLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={() => setShowServiceForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nouveau service
                </Button>
              </div>
            </div>
            {showServiceForm && (
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Nouveau service</h3>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="border rounded-md px-3 py-2 text-sm"
                    value={serviceForm.type}
                    onChange={(e) => setServiceForm((f) => ({ ...f, type: e.target.value as "offer" | "seeker" | "atelier" }))}
                  >
                    <option value="offer">Offre d'emploi</option>
                    <option value="seeker">Demande d'emploi</option>
                    <option value="atelier">Atelier</option>
                  </select>
                  <Input placeholder="Titre *" value={serviceForm.title} onChange={(e) => setServiceForm((f) => ({ ...f, title: e.target.value }))} />
                  <Input placeholder="Contact *" value={serviceForm.contact} onChange={(e) => setServiceForm((f) => ({ ...f, contact: e.target.value }))} />
                  <Input placeholder="Quartier" value={serviceForm.quartier} onChange={(e) => setServiceForm((f) => ({ ...f, quartier: e.target.value }))} />
                  <Input placeholder="Ville" value={serviceForm.ville} onChange={(e) => setServiceForm((f) => ({ ...f, ville: e.target.value }))} />
                </div>
                <textarea
                  className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px] resize-none"
                  placeholder="Description *"
                  value={serviceForm.description}
                  onChange={(e) => setServiceForm((f) => ({ ...f, description: e.target.value }))}
                />
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="file" accept="image/*" ref={serviceImageRef} className="hidden" onChange={handleServiceImageChange} />
                  <input type="file" accept="video/*" ref={serviceVideoRef} className="hidden" onChange={handleServiceVideoChange} disabled={serviceVideoStatus !== "idle"} />
                  <Button variant="outline" size="sm" onClick={() => serviceImageRef.current?.click()}>Image</Button>
                  <Button variant="outline" size="sm" onClick={() => serviceVideoRef.current?.click()} disabled={serviceVideoStatus !== "idle"}>
                    {serviceVideoStatus === "compressing" ? "⏳ Compression..." : serviceVideoStatus === "uploading" ? "⬆️ Envoi..." : serviceForm.videoName ? "🎬 Vidéo ✓" : "🎬 Vidéo"}
                  </Button>
                  {serviceForm.imagePreview && <img src={serviceForm.imagePreview} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                  {serviceForm.videoName && <span className="text-xs text-muted-foreground truncate max-w-[120px]">✅ {serviceForm.videoName}</span>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateService} disabled={createService.isPending}>
                    {createService.isPending ? "Création…" : "Créer"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowServiceForm(false)}>Annuler</Button>
                </div>
              </div>
            )}
            {servicesLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : allServices.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucun service</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allServices.map((s) => {
                  const svcExpired = new Date(s.expiresAt) < new Date();
                  const svcActive = s.isPublished && !svcExpired;
                  return (
                  <div key={s.id} className={`bg-card border rounded-xl p-3 flex items-center gap-3 ${svcExpired ? "border-red-200 bg-red-50/30" : ""}`}>
                    {(s.image || s.videoPath) && (
                      <div className="relative w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden bg-black/10">
                        {s.videoPath
                          ? <SmartVideo src={resolveImageUrl(s.videoPath)} mode="thumbnail" className="w-full h-full" />
                          : <img src={resolveImageUrl(s.image!)} alt="" className="w-full h-full object-cover" />}
                        {s.image && s.videoPath && (
                          <span className="absolute top-0.5 left-0.5 bg-black/60 rounded text-white text-[9px] px-1">🎬</span>
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-semibold text-sm truncate">{s.title}</p>
                        {svcExpired && <span className="text-[10px] bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-semibold shrink-0">⏰ Expiré</span>}
                        {svcActive && <span className="text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold shrink-0">Actif</span>}
                        {!s.isPublished && !svcExpired && <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5 font-semibold shrink-0">En attente</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">{s.type} · {s.ville ?? s.quartier ?? ""}</p>
                      <p className="text-xs text-muted-foreground">Exp. : {new Date(s.expiresAt).toLocaleDateString("fr-FR")}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                      {svcExpired && (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-orange-400 text-orange-700 hover:bg-orange-50" onClick={() => handleSendRenewalWhatsApp("service", s.id, s.title, s.contact ?? "")}>
                          🔄 Renouveler
                        </Button>
                      )}
                      {!s.isPublished && !svcExpired && (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-green-400 text-green-700 hover:bg-green-50" onClick={() => setConfirmPublishItem({ type: "service", id: s.id, title: s.title })}>
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Valider
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-green-600" title="Envoyer lien de paiement initial" onClick={() => setPaymentLinkDialog({ entityType: "service", entityId: s.id, customerName: s.title, customerPhone: s.contact ?? "" })}>
                        📲
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => { if (confirm("Supprimer ce service ?")) handleDeleteService(s.id); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PARAMÈTRES ───────────────────────────────────────── */}
        {tab === "settings" && (
          <div className="space-y-4 max-w-lg">
            <h2 className="text-lg font-bold">Paramètres</h2>
            <div className="bg-card border rounded-xl p-4 space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">Taux de commission (%)</label>
                <select
                  className="border rounded-md px-3 py-2 text-sm w-full"
                  value={settingsForm.commissionRate}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, commissionRate: e.target.value }))}
                >
                  {[0, 2, 3, 4, 5].map((r) => (
                    <option key={r} value={r}>{r}%{r === 0 ? " (Gratuit)" : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">WhatsApp commissions</label>
                <Input placeholder="22870703131" value={settingsForm.whatsappCommission} onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappCommission: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">WhatsApp commandes</label>
                <Input placeholder="22870703131" value={settingsForm.whatsappOrders} onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappOrders: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">WhatsApp publicités</label>
                <Input placeholder="22870703131" value={settingsForm.whatsappAds} onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappAds: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">WhatsApp services</label>
                <Input placeholder="22870703131" value={settingsForm.whatsappServices} onChange={(e) => setSettingsForm((f) => ({ ...f, whatsappServices: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Mot de passe sous-admin</label>
                <Input placeholder="Nouveau mot de passe sous-admin" value={settingsForm.subAdminPwd} onChange={(e) => setSettingsForm((f) => ({ ...f, subAdminPwd: e.target.value }))} />
              </div>
              <Button onClick={handleSaveSettings} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? "Sauvegarde…" : "Sauvegarder"}
              </Button>
            </div>
          </div>
        )}

        {/* ── COMPTES ADMIN (superadmin uniquement) ────────────── */}
        {tab === "accounts" && isSuperAdmin && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Comptes admin ({accounts.length})</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadAccounts} disabled={accountsLoading}>
                  <RefreshCw className={`w-3.5 h-3.5 ${accountsLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button size="sm" onClick={() => setShowNewAccountForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Nouveau compte
                </Button>
              </div>
            </div>
            {showNewAccountForm && (
              <div className="bg-card border rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-sm">Nouveau compte admin</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Nom d'utilisateur *" value={newAccount.username} onChange={(e) => setNewAccount((a) => ({ ...a, username: e.target.value }))} />
                  <Input placeholder="Code d'accès *" type="password" value={newAccount.code} onChange={(e) => setNewAccount((a) => ({ ...a, code: e.target.value }))} />
                  <select
                    className="border rounded-md px-3 py-2 text-sm col-span-2"
                    value={newAccount.role}
                    onChange={(e) => setNewAccount((a) => ({ ...a, role: e.target.value }))}
                  >
                    <option value="admin_pub">Admin Publicités</option>
                    <option value="admin_event">Admin Événements</option>
                    <option value="admin_service">Admin Services</option>
                    <option value="admin_stats">Admin Statistiques</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreateAccount}>Créer</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewAccountForm(false)}>Annuler</Button>
                </div>
              </div>
            )}
            {accountsLoading ? (
              <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Aucun compte admin</p>
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map((acc) => (
                  <div key={acc.id} className="bg-card border rounded-xl p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Shield className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{acc.username}</p>
                      <p className="text-xs text-muted-foreground">{acc.role} · créé le {new Date(acc.createdAt).toLocaleDateString("fr-FR")}</p>
                    </div>
                    {acc.id !== 1 && (
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive flex-shrink-0"
                        onClick={() => { if (confirm(`Supprimer le compte "${acc.username}" ?`)) handleDeleteAccount(acc.id); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── BOÎTE DE RÉCEPTION (INBOX) ───────────────────────── */}
        {tab === "inbox" && (
          <div className="space-y-4">
            {selectedInboxConv ? (
              /* ── THREAD D'UNE CONVERSATION ── */
              <div className="flex flex-col h-[calc(100dvh-160px)]">
                {/* Header conversation */}
                <div className="flex items-center gap-3 pb-3 border-b">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { setSelectedInboxConv(null); setInboxMessages([]); }}>
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary">{selectedInboxConv.vendorFirstName[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{selectedInboxConv.vendorFirstName} {selectedInboxConv.vendorLastName}</p>
                    <p className="text-xs text-muted-foreground">{selectedInboxConv.vendorPhone}</p>
                  </div>
                  <button onClick={() => openInboxConv(selectedInboxConv)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto py-3 space-y-2">
                  {inboxMsgsLoading ? (
                    <div className="flex justify-center py-8"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                  ) : inboxMessages.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">Aucun message dans cette conversation.</div>
                  ) : (
                    inboxMessages.map((msg) => {
                      if (msg.deletedAt) return null;
                      const isAdmin = msg.senderType === "buyer";
                      const isEditing = inboxEditingId === msg.id;
                      const menuOpen = inboxMenuMsgId === msg.id;

                      return (
                        <div key={msg.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                          {/* Bubble + menu button wrapper */}
                          <div className={`relative group max-w-[80%] flex items-end gap-1 ${isAdmin ? "flex-row-reverse" : "flex-row"}`}>

                            {/* ⋮ menu button — visible hover desktop / long-press mobile */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (menuOpen) { setInboxMenuMsgId(null); setInboxMenuPos(null); }
                                else {
                                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  const menuH = 110;
                                  const top = r.top > menuH + 60 ? r.top - menuH - 6 : r.bottom + 6;
                                  setInboxMenuPos({ top, right: window.innerWidth - r.right });
                                  setInboxMenuMsgId(msg.id);
                                }
                              }}
                              className="flex-shrink-0 mb-1 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground"
                            >
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>

                            <div
                              className="relative"
                              onTouchStart={(e) => {
                                e.preventDefault();
                                const el = e.currentTarget as HTMLElement;
                                longPressTimer.current = setTimeout(() => {
                                  const r = el.getBoundingClientRect();
                                  const menuH = 110;
                                  const top = r.top > menuH + 60 ? r.top - menuH - 6 : r.bottom + 6;
                                  setInboxMenuPos({ top, right: window.innerWidth - r.right });
                                  setInboxMenuMsgId(msg.id);
                                }, 600);
                              }}
                              onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                              onTouchMove={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                              onTouchCancel={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                              onMouseDown={(e) => {
                                const el = e.currentTarget as HTMLElement;
                                longPressTimer.current = setTimeout(() => {
                                  const r = el.getBoundingClientRect();
                                  const menuH = 110;
                                  const top = r.top > menuH + 60 ? r.top - menuH - 6 : r.bottom + 6;
                                  setInboxMenuPos({ top, right: window.innerWidth - r.right });
                                  setInboxMenuMsgId(msg.id);
                                }, 600);
                              }}
                              onMouseUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                              onMouseLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                              onContextMenu={(e) => e.preventDefault()}
                            >
                              <div className={`rounded-2xl text-sm overflow-hidden select-none ${
                                isAdmin
                                  ? "bg-primary text-primary-foreground rounded-br-sm"
                                  : "bg-muted text-foreground rounded-bl-sm"
                              }`}>
                                {/* Sender label */}
                                <p className={`text-[10px] font-semibold px-3 pt-2 ${isAdmin ? "opacity-70" : "opacity-60"}`}>
                                  {isAdmin ? "TogoMarket" : "Vendeur"}
                                </p>

                                {/* Mode édition inline */}
                                {isEditing ? (
                                  <div className="px-3 pb-2 space-y-1.5">
                                    <textarea
                                      autoFocus
                                      className="w-full border border-primary-foreground/30 rounded-lg px-2 py-1.5 text-sm bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/50 resize-none focus:outline-none min-h-[60px]"
                                      value={inboxEditContent}
                                      onChange={(e) => setInboxEditContent(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); editInboxMessage(); } if (e.key === "Escape") { setInboxEditingId(null); } }}
                                    />
                                    <div className="flex gap-1.5">
                                      <button onClick={editInboxMessage} className="text-[11px] font-semibold bg-primary-foreground/20 hover:bg-primary-foreground/30 rounded px-2 py-0.5">Enregistrer</button>
                                      <button onClick={() => setInboxEditingId(null)} className="text-[11px] opacity-70 hover:opacity-100 rounded px-2 py-0.5">Annuler</button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {/* Image */}
                                    {msg.fileUrl && msg.fileType === "image" && (
                                      <div
                                        onClick={(e) => { e.stopPropagation(); window.open(resolveImageUrl(msg.fileUrl!), "_blank", "noopener,noreferrer"); }}
                                        className="cursor-pointer"
                                      >
                                        <img src={resolveImageUrl(msg.fileUrl)} alt="image" draggable={false} onContextMenu={(e) => e.preventDefault()} className="max-w-[220px] max-h-[220px] object-cover block mt-1" />
                                      </div>
                                    )}
                                    {/* Audio */}
                                    {msg.fileUrl && msg.fileType === "audio" && (
                                      <div className="px-3 py-2">
                                        <audio controls src={resolveImageUrl(msg.fileUrl)} className="h-10 max-w-[200px]" />
                                      </div>
                                    )}
                                    {/* PDF */}
                                    {msg.fileUrl && msg.fileType === "pdf" && (
                                      <div
                                        onClick={(e) => { e.stopPropagation(); window.open(resolveImageUrl(msg.fileUrl!), "_blank", "noopener,noreferrer"); }}
                                        onContextMenu={(e) => e.preventDefault()}
                                        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                                      >
                                        <FileText className="w-8 h-8 flex-shrink-0 opacity-80" />
                                        <span className="text-xs font-medium underline break-all">Voir le PDF</span>
                                      </div>
                                    )}
                                    {/* Text */}
                                    {msg.content && <p className="px-3 py-2 break-words whitespace-pre-wrap">{msg.content}</p>}
                                    {/* Modifié */}
                                    {msg.editedAt && <p className={`text-[10px] pb-0.5 px-3 opacity-60 ${isAdmin ? "text-right" : ""}`}>Modifié</p>}
                                  </>
                                )}

                                <p className={`text-[10px] pb-2 px-3 ${isAdmin ? "text-primary-foreground/60 text-right" : "text-muted-foreground"}`}>
                                  {new Date(msg.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                </p>
                              </div>

                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={inboxBottomRef} />
                </div>

                {/* Zone de réponse */}
                <div className="pt-3 border-t space-y-2">
                  {/* Barre d'enregistrement */}
                  {inboxIsRecording && (
                    <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 rounded-xl px-3 py-2">
                      <span className="w-2 h-2 rounded-full bg-destructive animate-pulse flex-shrink-0" />
                      <span className="text-sm font-medium text-destructive flex-1">
                        Enregistrement… {String(Math.floor(inboxRecordingDuration / 60)).padStart(2, "0")}:{String(inboxRecordingDuration % 60).padStart(2, "0")}
                      </span>
                      <Button size="sm" variant="destructive" className="h-8 gap-1.5" onClick={stopInboxRecording}>
                        <StopCircle className="w-4 h-4" />
                        Arrêter
                      </Button>
                    </div>
                  )}

                  {/* Input fichier caché */}
                  <input
                    ref={inboxFileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,application/pdf"
                    className="hidden"
                    onChange={handleInboxFileChange}
                  />

                  {/* Ligne d'envoi */}
                  {!inboxIsRecording && (
                    <div className="flex gap-2 items-end">
                      {/* Bouton fichier */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0 flex-shrink-0 text-muted-foreground hover:text-foreground"
                        disabled={inboxUploading}
                        onClick={() => inboxFileInputRef.current?.click()}
                        title="Joindre une image ou un PDF"
                      >
                        {inboxUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                      </Button>
                      {/* Bouton micro */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 w-10 p-0 flex-shrink-0 text-muted-foreground hover:text-primary"
                        disabled={inboxUploading || inboxReplying}
                        onClick={startInboxRecording}
                        title="Envoyer un message vocal"
                      >
                        <Mic className="w-4 h-4" />
                      </Button>
                      <textarea
                        className="flex-1 border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 min-h-[42px] max-h-32"
                        placeholder="Répondre en tant que TogoMarket…"
                        value={inboxReply}
                        rows={1}
                        onChange={(e) => setInboxReply(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendInboxReply(); } }}
                      />
                      <Button
                        size="sm"
                        className="h-10 w-10 p-0 flex-shrink-0"
                        disabled={!inboxReply.trim() || inboxReplying}
                        onClick={sendInboxReply}
                      >
                        {inboxReplying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── LISTE DES CONVERSATIONS ── */
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">Boîte de réception</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Réponses des vendeurs aux messages de diffusion</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadInbox} disabled={inboxLoading}>
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${inboxLoading ? "animate-spin" : ""}`} />
                    Actualiser
                  </Button>
                </div>

                {inboxLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map(n => (
                      <div key={n} className="bg-card border rounded-xl p-4 flex gap-3 animate-pulse">
                        <div className="w-10 h-10 rounded-full bg-muted flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 bg-muted rounded w-1/3" />
                          <div className="h-3 bg-muted rounded w-2/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : inboxConvs.length === 0 ? (
                  <div className="text-center py-20">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" />
                    <p className="text-muted-foreground text-sm">Aucune réponse de vendeur pour l'instant.</p>
                    <p className="text-xs text-muted-foreground mt-1">Les vendeurs qui répondent à vos diffusions apparaîtront ici.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {inboxConvs.map((conv) => (
                      <button
                        key={conv.id}
                        className="w-full text-left bg-card border rounded-xl p-4 flex gap-3 hover:border-primary/50 hover:shadow-sm active:scale-[0.99] transition-all"
                        onClick={() => openInboxConv(conv)}
                      >
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-primary">{conv.vendorFirstName[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-sm truncate">{conv.vendorFirstName} {conv.vendorLastName}</p>
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">
                              {new Date(conv.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {conv.lastSenderType === "buyer" && <span className="text-primary font-medium">Vous : </span>}
                            {conv.lastMessage ?? "Aucun message"}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{conv.vendorPhone}</p>
                        </div>
                        {conv.adminUnreadCount > 0 && (
                          <div className="flex-shrink-0 self-center">
                            <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                              {conv.adminUnreadCount}
                            </span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </main>

      {/* ── MENU CONTEXTUEL INBOX (position fixe, en dehors de la chaîne touch) ── */}
      {inboxMenuMsgId !== null && inboxMenuPos && (() => {
        const menuMsg = inboxMessages.find((m) => m.id === inboxMenuMsgId);
        if (!menuMsg || menuMsg.deletedAt) return null;
        const isAdminMsg = menuMsg.senderType === "buyer";
        const closeInboxMenu = () => { setInboxMenuMsgId(null); setInboxMenuPos(null); };
        return (
          <>
            {/* Fond transparent : tap dehors = fermeture */}
            <div className="fixed inset-0 z-40" onTouchStart={closeInboxMenu} onClick={closeInboxMenu} />
            <div
              style={{ position: "fixed", top: inboxMenuPos.top, right: inboxMenuPos.right, zIndex: 9999 }}
              className="bg-popover border rounded-xl shadow-xl py-1 min-w-[170px]"
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {isAdminMsg && !menuMsg.fileUrl && (
                <button
                  className="w-full text-left flex items-center gap-2 px-4 py-3 text-sm hover:bg-muted transition-colors"
                  onClick={() => { closeInboxMenu(); setInboxEditingId(menuMsg.id); setInboxEditContent(menuMsg.content ?? ""); }}
                >
                  <Pencil className="w-4 h-4" />
                  Modifier
                </button>
              )}
              <button
                className="w-full text-left flex items-center gap-2 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                onClick={() => { closeInboxMenu(); deleteInboxMessage(menuMsg.id); }}
              >
                <Trash2 className="w-4 h-4" />
                Supprimer pour tous
              </button>
            </div>
          </>
        );
      })()}

      {viewerImages.length > 0 && (
        <ImageViewer
          images={viewerImages}
          startIndex={viewerIndex}
          onClose={() => setViewerImages([])}
        />
      )}

      {/* ── LECTEUR VIDÉO ──────────────────────────────────────── */}
      <Dialog open={!!videoPlayerUrl} onOpenChange={(o) => { if (!o) setVideoPlayerUrl(null); }}>
        <DialogContent className="max-w-lg p-2 bg-black border-black">
          {videoPlayerUrl && (
            <video
              key={videoPlayerUrl}
              src={videoPlayerUrl}
              controls
              autoPlay
              playsInline
              className="w-full max-h-[70vh] rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── CONFIRMATION +30 JOURS ────────────────────────────── */}
      <Dialog open={!!confirm30Vendor} onOpenChange={(v) => { if (!v) setConfirm30Vendor(null); }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Confirmer +30 jours</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Réactiver la boutique de <strong>{confirm30Vendor?.name}</strong> pour 30 jours supplémentaires ?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm30Vendor(null)} disabled={confirm30Loading}>
              Annuler
            </Button>
            <Button onClick={handleForcePublishVendor} disabled={confirm30Loading} className="bg-blue-600 hover:bg-blue-700 text-white">
              {confirm30Loading ? "En cours…" : "Confirmer +30 jours"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CONFIRMATION VALIDATION PUBLICITÉ/ÉVÉNEMENT/SERVICE ── */}
      <Dialog open={!!confirmPublishItem} onOpenChange={(v) => { if (!v) setConfirmPublishItem(null); }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Confirmer la publication</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Valider et publier <strong>« {confirmPublishItem?.title} »</strong> ?
            {confirmPublishItem?.type === "ad" && " La publicité sera active 30 jours."}
            {confirmPublishItem?.type === "service" && " Le service sera actif 30 jours."}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmPublishItem(null)} disabled={confirmPublishLoading}>
              Annuler
            </Button>
            <Button onClick={handleForcePublishItem} disabled={confirmPublishLoading} className="bg-green-600 hover:bg-green-700 text-white">
              {confirmPublishLoading ? "Publication…" : "Valider et publier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── LIEN DE PAIEMENT FEDAPAY ───────────────────────────── */}
      <Dialog open={!!paymentLinkDialog} onOpenChange={(v) => { if (!v) setPaymentLinkDialog(null); }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Envoyer lien de paiement (1 000 FCFA)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Générez un lien FedaPay et envoyez-le au client via WhatsApp.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Nom du client</label>
              <Input
                value={paymentLinkDialog?.customerName ?? ""}
                onChange={(e) => setPaymentLinkDialog((d) => d ? { ...d, customerName: e.target.value } : d)}
                placeholder="Nom du client"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Téléphone du client</label>
              <Input
                value={paymentLinkDialog?.customerPhone ?? ""}
                onChange={(e) => setPaymentLinkDialog((d) => d ? { ...d, customerPhone: e.target.value } : d)}
                placeholder="Ex: 22890123456"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPaymentLinkDialog(null)} disabled={paymentLinkLoading}>
              Annuler
            </Button>
            <Button
              onClick={handleSendPaymentLink}
              disabled={paymentLinkLoading || !paymentLinkDialog?.customerName || !paymentLinkDialog?.customerPhone}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {paymentLinkLoading ? "Génération…" : "Générer & Envoyer via WhatsApp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
