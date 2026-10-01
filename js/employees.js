// Employee accounts and the manager/admin enrollment approval workflow.
import { initShell, deptLabel, roleLabel } from '../script.js';
import { getUser, isAdmin, refreshProfile } from './auth.js';
import { api } from './api.js';
import {
  esc, toast, openModal, confirmDialog, field, formValue,
  badge, statusBadge, emptyRow
} from './ui.js';

const shell = initShell({ active: 'employees', requireAuth: true });

let users = [];
let applications = [];

if (shell) init();

function init() {
  if (isAdmin()) {
    document.getElementById('admin-accounts').classList.remove('hidden');
    document.getElementById('add-employee').addEventListener('click', () => employeeModal(null));
    document.getElementById('user-search').addEventListener('input', renderUsers);
    document.getElementById('users-body').addEventListener('click', onUsersClick);
    loadUsers();
  }
  document.getElementById('applications-body').addEventListener('click', onApplicationsClick);
  document.getElementById('refresh-applications').addEventListener('click', loadApplications);
  window.addEventListener('online', loadUsers);
  window.addEventListener('offline', updateOfflineNote);
  loadApplications();
}

function isOnline() {
  return navigator.onLine;
}

function updateOfflineNote() {
  document.getElementById('offline-note').hidden = isOnline();
}

async function loadUsers() {
  if (!isAdmin()) return;
  updateOfflineNote();
  if (!isOnline()) return;
  try {
    const data = await api.listUsers();
    users = data.users;
    renderUsers();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      window.location.href = 'dashboard.html';
      return;
    }
    toast(err.message, 'error');
  }
}

async function loadApplications() {
  updateOfflineNote();
  if (!isOnline()) return;
  try {
    const data = await api.listApplications();
    applications = data.applications;
    renderApplications();
  } catch (err) {
    if (err.status === 401 || err.status === 403) window.location.href = 'dashboard.html';
    else toast(err.message, 'error');
  }
}

function applicationStatus(status) {
  const tones = { submitted: 'blue', forwarded: 'amber', approved: 'green', rejected: 'red', credentials_created: 'green' };
  const labels = { submitted: 'Awaiting manager', forwarded: 'Awaiting admin', approved: 'Approved', rejected: 'Rejected', credentials_created: 'Account created' };
  return badge(labels[status] || status, tones[status] || 'gray');
}

function renderApplications() {
  const admin = isAdmin();
  document.getElementById('applications-body').innerHTML = applications.length
    ? applications.map((application) => `<tr>
        <td><strong>${esc(application.name)}</strong><br><span class="muted">${esc(application.email)}${application.phone ? ` · ${esc(application.phone)}` : ''}</span></td>
        <td>${badge(deptLabel(application.department), 'blue')}</td>
        <td>${esc(application.requirements)}</td>
        <td>${applicationStatus(application.status)}${application.rejection_reason ? `<br><span class="muted">${esc(application.rejection_reason)}</span>` : ''}</td>
        <td>${new Date(Number(application.created_at)).toLocaleDateString()}</td>
        <td class="actions-cell">${applicationActions(application, admin)}</td>
      </tr>`).join('')
    : emptyRow(6, 'No enrollment applications found.');
}

function applicationActions(application, admin) {
  if (!admin && application.status === 'submitted') return `<button class="btn btn-primary btn-sm" data-app-act="forward" data-id="${application.id}" type="button">Forward to admin</button>`;
  if (admin && application.status === 'forwarded') return `<button class="btn btn-primary btn-sm" data-app-act="approve" data-id="${application.id}" type="button">Approve</button> <button class="btn btn-ghost btn-sm" data-app-act="reject" data-id="${application.id}" type="button">Reject</button>`;
  if (!admin && application.status === 'approved') return `<button class="btn btn-primary btn-sm" data-app-act="credentials" data-id="${application.id}" type="button">Create credentials</button>`;
  return '';
}

async function onApplicationsClick(event) {
  const button = event.target.closest('button[data-app-act]');
  if (!button) return;
  const application = applications.find((item) => item.id === button.dataset.id);
  if (!application) return;
  try {
    if (button.dataset.appAct === 'forward') {
      await api.forwardApplication(application.id);
      toast('Application forwarded to the administrator.', 'success');
    } else if (button.dataset.appAct === 'approve') {
      await api.approveApplication(application.id);
      toast('Application approved. The manager can now create credentials.', 'success');
    } else if (button.dataset.appAct === 'reject') {
      const reason = window.prompt('Reason for rejection:', 'The requirements did not meet approval criteria.') || 'The administrator did not approve this application.';
      await api.rejectApplication(application.id, reason);
      toast('Application rejected and the applicant was notified.', 'success');
    } else if (button.dataset.appAct === 'credentials') {
      await credentialsModal(application);
      return;
    }
    await loadApplications();
  } catch (err) { toast(err.message, 'error'); }
}

function credentialsModal(application) {
  return openModal({
    title: `Create credentials for ${application.name}`,
    submitLabel: 'Create login credentials',
    bodyHTML: `${field({ label: 'Login email', name: 'email', value: application.email })}${field({ label: 'Temporary password', name: 'password', type: 'password', required: true, placeholder: 'At least 6 characters' })}`,
    onSubmit: async (form) => {
      const password = formValue(form, 'password');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      await api.createApplicationCredentials(application.id, password);
      toast('Credentials created and the applicant was notified.', 'success');
      await loadApplications();
    }
  }).catch(() => {});
}

function renderUsers() {
  const me = getUser();
  const query = (document.getElementById('user-search').value || '').toLowerCase();
  const list = users.filter((u) =>
    !query ||
    String(u.name || '').toLowerCase().includes(query) ||
    String(u.email || '').toLowerCase().includes(query) ||
    String(u.department || '').toLowerCase().includes(query));

  document.getElementById('users-body').innerHTML = list.length
    ? list.map((u) => {
      const roleTone = u.role === 'admin' ? 'purple' : (u.role === 'manager' ? 'amber' : 'gray');
      const canDelete = u.id !== me.id;
      return `<tr>
        <td>${esc(u.name)} ${u.id === me.id ? badge('You', 'blue') : ''}</td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.phone || '—')}</td>
        <td>${badge(deptLabel(u.department), 'blue')}</td>
        <td>${badge(roleLabel(u.role), roleTone)}</td>
        <td>${statusBadge(u.status)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${u.id}" type="button">Edit</button>
          ${canDelete ? `<button class="btn btn-ghost btn-sm" data-act="delete" data-id="${u.id}" type="button">Delete</button>` : ''}
        </td>
      </tr>`;
    }).join('')
    : emptyRow(7, 'No employees found.');
}

async function onUsersClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const user = users.find((u) => u.id === button.dataset.id);
  if (!user) return;

  if (button.dataset.act === 'edit') {
    employeeModal(user);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog(`Delete the account for "${user.name}"? They will no longer be able to sign in.`, { title: 'Delete employee', okLabel: 'Delete' });
    if (!ok) return;
    try {
      await api.deleteUser(user.id);
      toast('Employee account deleted.', 'success');
      await loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function employeeModal(user) {
  if (!isOnline()) {
    toast('Employee management needs a network connection.', 'info');
    return;
  }
  const me = getUser();
  const isEdit = !!user;

  const deptOptions = [
    { value: 'shop', label: 'Shop' },
    { value: 'transport', label: 'Transport' },
    { value: 'restaurant', label: 'Restaurant' },
    { value: 'head-office', label: 'Head Office' }
  ];
  const roleOptions = [
    { value: 'staff', label: 'Staff' },
    { value: 'manager', label: 'Manager' },
    { value: 'admin', label: 'Administrator' }
  ];

  openModal({
    title: isEdit ? `Edit ${user.name}` : 'Add employee',
    submitLabel: isEdit ? 'Save changes' : 'Create account',
    bodyHTML: `
      ${field({ label: 'Full name', name: 'name', value: user ? user.name : '', required: true, placeholder: 'e.g. Jane Wanjiru' })}
      ${isEdit
        ? `<p class="field"><span class="field-label">Email</span><span class="muted">${esc(user.email)}</span></p>`
        : field({ label: 'Email address', name: 'email', type: 'email', required: true, placeholder: 'employee@example.com' })}
      ${field({ label: 'Phone', name: 'phone', type: 'tel', value: user ? user.phone : '', placeholder: '+254 7xx xxx xxx' })}
      <div class="field-row">
        ${field({ label: 'Department', name: 'department', value: user ? user.department : 'shop', options: deptOptions })}
        ${field({ label: 'Role', name: 'role', value: user ? user.role : 'staff', options: roleOptions })}
      </div>
      ${isEdit
        ? field({ label: 'Status', name: 'status', value: user.status, options: [{ value: 'active', label: 'Active' }, { value: 'disabled', label: 'Disabled' }] })
        : ''}
      ${field({ label: isEdit ? 'New password (leave blank to keep current)' : 'Password', name: 'password', type: 'password', required: !isEdit, placeholder: isEdit ? 'Optional' : 'At least 6 characters' })}
    `,
    onSubmit: async (form) => {
      const payload = {
        name: formValue(form, 'name'),
        phone: formValue(form, 'phone'),
        department: formValue(form, 'department'),
        role: formValue(form, 'role'),
        password: formValue(form, 'password')
      };
      if (isEdit) payload.status = formValue(form, 'status') || user.status;
      else payload.email = formValue(form, 'email');

      if (!payload.name || payload.name.length < 2) throw new Error('Enter the employee name.');
      if (!isEdit && !payload.email) throw new Error('Enter the email address.');
      if (!isEdit && payload.password.length < 6) throw new Error('Password must be at least 6 characters.');

      if (isEdit) {
        await api.updateUser(user.id, payload);
        toast('Employee updated.', 'success');
        if (user.id === me.id) await refreshProfile();
      } else {
        await api.createUser(payload);
        toast('Employee account created.', 'success');
      }
      await loadUsers();
    }
  }).catch(() => {});
}
