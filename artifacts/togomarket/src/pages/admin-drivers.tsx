import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminDeliverySupervisor } from "@/components/delivery-components";
import { uploadImageFile } from "@/lib/upload";
import { resolveImageUrl } from "@/lib/image";
import {
  loadAdminDrivers,
  saveAdminDriver,
  deleteAdminDriver,
  type AdminDriver,
  type AdminDriverInput,
  type DeliveryAdminOrder,
} from "./admin-delivery-api";

type DriverForm = {
  firstName: string;
  lastName: string;
  phone: string;
  whatsappNumber: string;
  workZone: string;
  idDocumentNumber: string;
  photoUrl: string;
  idDocumentPhotoUrl: string;
};

const emptyForm: DriverForm = {
  firstName: "",
  lastName: "",
  phone: "",
  whatsappNumber: "",
  workZone: "",
  idDocumentNumber: "",
  photoUrl: "",
  idDocumentPhotoUrl: "",
};

export default function AdminDrivers({
  adminCode,
  isSuperAdmin,
  orders,
}: {
  adminCode: string;
  isSuperAdmin: boolean;
  orders: DeliveryAdminOrder[];
}) {
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [form, setForm] = useState<DriverForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setDrivers(await loadAdminDrivers(adminCode));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [adminCode]);

  if (!isSuperAdmin) {
    return <p className="rounded-xl border p-6 text-sm text-destructive">Accès réservé au superadmin.</p>;
  }

  const editDriver = (driver: AdminDriver) => {
    setEditingId(driver.id);
    setPhotoFile(null);
    setDocumentFile(null);
    setForm({
      firstName: driver.firstName,
      lastName: driver.lastName,
      phone: driver.phone,
      whatsappNumber: driver.whatsappNumber ?? "",
      workZone: driver.workZone ?? "",
      idDocumentNumber: driver.idDocumentNumber ?? "",
      photoUrl: driver.photoUrl ?? "",
      idDocumentPhotoUrl: driver.idDocumentPhotoUrl ?? "",
    });
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const photoUrl = photoFile
        ? await uploadImageFile(photoFile, photoFile.name, { adminCode })
        : form.photoUrl;
      const idDocumentPhotoUrl = documentFile
        ? await uploadImageFile(documentFile, documentFile.name, { adminCode })
        : form.idDocumentPhotoUrl;
      const payload: AdminDriverInput = {
        ...form,
        photoUrl: photoUrl || null,
        idDocumentPhotoUrl: idDocumentPhotoUrl || null,
        whatsappNumber: form.whatsappNumber || form.phone,
      };
      await saveAdminDriver(adminCode, payload, editingId ?? undefined);
      setForm(emptyForm);
      setEditingId(null);
      setPhotoFile(null);
      setDocumentFile(null);
      setMessage(editingId ? "Profil livreur mis à jour." : "Livreur créé.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (driver: AdminDriver, field: "isActive" | "isAvailable") => {
    setError(null);
    try {
      await saveAdminDriver(adminCode, { [field]: !driver[field] }, driver.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const confirmDelete = async (driverId: number) => {
    setDeletingId(driverId);
    setError(null);
    setMessage(null);
    try {
      await deleteAdminDriver(adminCode, driverId);
      setConfirmDeleteId(null);
      if (editingId === driverId) {
        setEditingId(null);
        setForm(emptyForm);
      }
      setMessage("Livreur supprimé.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-driver-management">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Livreurs ({drivers.length})</h2>
          <p className="text-sm text-muted-foreground">Gestion réservée au superadmin.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { void refresh(); }} disabled={loading}>
          Actualiser
        </Button>
      </div>
      {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}
      {message && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700" role="status">{message}</p>}
      <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2" onSubmit={(event) => { void save(event); }}>
        <h3 className="font-semibold md:col-span-2">{editingId ? "Modifier le livreur" : "Créer un livreur"}</h3>
        <Input required placeholder="Prénom" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
        <Input required placeholder="Nom" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
        <Input required placeholder="Téléphone / WhatsApp" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        <Input placeholder="WhatsApp (facultatif)" value={form.whatsappNumber} onChange={(event) => setForm({ ...form, whatsappNumber: event.target.value })} />
        <Input placeholder="Zone de travail" value={form.workZone} onChange={(event) => setForm({ ...form, workZone: event.target.value })} />
        <Input placeholder="Numéro du document d'identité" value={form.idDocumentNumber} onChange={(event) => setForm({ ...form, idDocumentNumber: event.target.value })} />
        <label className="space-y-1 text-xs text-muted-foreground">
          Photo de profil
          <Input type="file" accept="image/*" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Photo du document d'identité (privée)
          <Input type="file" accept="image/*" onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)} />
        </label>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" disabled={saving}>{saving ? "Enregistrement…" : editingId ? "Enregistrer" : "Créer le profil"}</Button>
          {editingId !== null && (
            <Button type="button" variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Annuler</Button>
          )}
        </div>
      </form>
      {loading ? (
        <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Chargement des livreurs…</p>
      ) : drivers.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun livreur enregistré.</p>
      ) : (
        <div className="space-y-3">
          {drivers.map((driver) => {
            const assignment = orders.find((order) =>
              order.assignment?.driverId === driver.id
              && order.assignment.acceptanceStatus === "accepted_by_driver",
            );
            const isConfirmingDelete = confirmDeleteId === driver.id;
            return (
              <article key={driver.id} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="h-12 w-12 overflow-hidden rounded-full bg-muted">
                    {driver.photoUrl && <img src={resolveImageUrl(driver.photoUrl)} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{driver.firstName} {driver.lastName}</p>
                    <p className="text-xs text-muted-foreground">{driver.workZone || "Zone non précisée"} · {driver.phone}</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => editDriver(driver)}>Modifier</Button>
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={driver.isActive} onChange={() => { void toggle(driver, "isActive"); }} />
                    Actif
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={driver.isAvailable} onChange={() => { void toggle(driver, "isAvailable"); }} />
                    Disponible
                  </label>
                  <span className="text-muted-foreground">
                    Mission active : {assignment ? `commande #${assignment.id}` : "aucune"}
                  </span>
                </div>
                {assignment?.assignment && (
                  <AdminDeliverySupervisor
                    deliveryJobId={assignment.assignment.id}
                    orderStatus={assignment.status}
                    adminCode={adminCode}
                  />
                )}
                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Documents privés · superadmin</summary>
                  <div className="mt-3 space-y-2 text-sm">
                    <p>Numéro d'identité : {driver.idDocumentNumber || "Non renseigné"}</p>
                    {driver.idDocumentPhotoUrl && (
                      <img
                        src={resolveImageUrl(driver.idDocumentPhotoUrl)}
                        alt="Document d'identité privé"
                        className="max-h-56 max-w-full rounded-lg object-contain"
                      />
                    )}
                  </div>
                </details>
                <div className="border-t pt-3">
                  {!isConfirmingDelete ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => setConfirmDeleteId(driver.id)}
                      data-testid={`delete-driver-${driver.id}`}
                    >
                      Supprimer le livreur
                    </Button>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-sm font-medium text-destructive">
                        Confirmer la suppression définitive de {driver.firstName} {driver.lastName} ?
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Cette action est irréversible. Le livreur ne pourra plus se connecter ni recevoir de nouvelles missions.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={deletingId === driver.id}
                          onClick={() => { void confirmDelete(driver.id); }}
                        >
                          {deletingId === driver.id ? "Suppression…" : "Oui, supprimer"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={deletingId === driver.id}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
