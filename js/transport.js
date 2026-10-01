// Transport department: Vehicles, Drivers and Trips / Shipments.
import { initShell } from '../script.js';
import { DB, saveRecord, deleteRecord } from './db.js';
import { notifyLocalChange } from './sync.js';
import {
  esc, fmtDateTime, toast, openModal, confirmDialog, field, formValue,
  statusBadge, emptyRow, setupTabs, toDatetimeLocal, fromDatetimeLocal
} from './ui.js';

const shell = initShell({ active: 'transport', requireDepartment: 'transport' });

let vehicles = [];
let drivers = [];
let trips = [];

if (shell) init();

function init() {
  setupTabs(document);

  document.getElementById('add-vehicle').addEventListener('click', () => vehicleModal(null));
  document.getElementById('add-driver').addEventListener('click', () => driverModal(null));
  document.getElementById('add-trip').addEventListener('click', () => tripModal(null));

  document.getElementById('vehicle-search').addEventListener('input', renderVehicles);
  document.getElementById('driver-search').addEventListener('input', renderDrivers);

  document.getElementById('vehicles-body').addEventListener('click', onVehiclesClick);
  document.getElementById('drivers-body').addEventListener('click', onDriversClick);
  document.getElementById('trips-body').addEventListener('click', onTripsClick);

  refreshAll();
  document.addEventListener('tukent:synced', refreshAll);
}

async function refreshAll() {
  await loadAll();
  renderVehicles();
  renderDrivers();
  renderTrips();
}

async function loadAll() {
  [vehicles, drivers, trips] = await Promise.all([
    DB.getAll('vehicles'),
    DB.getAll('drivers'),
    DB.getAll('trips')
  ]);
  vehicles.sort((a, b) => String(a.plate_no).localeCompare(String(b.plate_no)));
  drivers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  trips.sort((a, b) => Number(b.departure || 0) - Number(a.departure || 0));
}

async function afterWrite(message) {
  toast(message, 'success');
  await notifyLocalChange();
  await refreshAll();
}

function vehicleName(id) {
  const vehicle = vehicles.find((v) => v.id === id);
  return vehicle ? vehicle.plate_no : 'Unassigned';
}

function driverName(id) {
  const driver = drivers.find((d) => d.id === id);
  return driver ? driver.name : 'Unassigned';
}

// ---- Vehicles ----------------------------------------------------------------

function renderVehicles() {
  const query = (document.getElementById('vehicle-search').value || '').toLowerCase();
  const list = vehicles.filter((v) =>
    !query ||
    String(v.plate_no || '').toLowerCase().includes(query) ||
    String(v.model || '').toLowerCase().includes(query));

  document.getElementById('vehicles-body').innerHTML = list.length
    ? list.map((v) => `<tr>
        <td><strong>${esc(v.plate_no || '—')}</strong></td>
        <td>${esc(v.model || '—')}</td>
        <td>${esc(v.vehicle_type || '—')}</td>
        <td>${esc(v.capacity || '—')}</td>
        <td>${statusBadge(v.status)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${v.id}" type="button">Edit</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${v.id}" type="button">Delete</button>
        </td>
      </tr>`).join('')
    : emptyRow(6, 'No vehicles yet. Add your first vehicle.');
}

async function onVehiclesClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const vehicle = vehicles.find((v) => v.id === button.dataset.id);
  if (button.dataset.act === 'edit') {
    vehicleModal(vehicle);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog(`Delete vehicle "${vehicle ? vehicle.plate_no : ''}"? Trips that reference it will show Unassigned.`, { title: 'Delete vehicle', okLabel: 'Delete' });
    if (!ok) return;
    await deleteRecord('vehicles', button.dataset.id);
    await afterWrite('Vehicle deleted.');
  }
}

async function vehicleModal(vehicle) {
  const isEdit = !!vehicle;
  await openModal({
    title: isEdit ? 'Edit vehicle' : 'Add vehicle',
    submitLabel: isEdit ? 'Save changes' : 'Add vehicle',
    bodyHTML: `
      <div class="field-row">
        ${field({ label: 'Plate number', name: 'plate_no', value: vehicle ? vehicle.plate_no : '', required: true, placeholder: 'KDA 123T' })}
        ${field({ label: 'Model', name: 'model', value: vehicle ? vehicle.model : '', placeholder: 'Isuzu FRR' })}
      </div>
      <div class="field-row">
        ${field({
          label: 'Type', name: 'vehicle_type', value: vehicle ? vehicle.vehicle_type : 'Truck',
          options: [
            { value: 'Truck', label: 'Truck' }, { value: 'Van', label: 'Van' },
            { value: 'Bus', label: 'Bus' }, { value: 'Pickup', label: 'Pickup' },
            { value: 'Car', label: 'Car' }, { value: 'Other', label: 'Other' }
          ]
        })}
        ${field({ label: 'Capacity', name: 'capacity', value: vehicle ? vehicle.capacity : '', placeholder: 'e.g. 8 tonnes / 14 seats' })}
      </div>
      ${field({
        label: 'Status', name: 'status', value: vehicle ? vehicle.status : 'available',
        options: [
          { value: 'available', label: 'Available' },
          { value: 'in-service', label: 'In service' },
          { value: 'maintenance', label: 'Maintenance' }
        ]
      })}
    `,
    onSubmit: async (form) => {
      const plate = formValue(form, 'plate_no');
      if (!plate) throw new Error('Enter the plate number.');
      await saveRecord('vehicles', {
        id: vehicle ? vehicle.id : undefined,
        created_at: vehicle ? vehicle.created_at : undefined,
        plate_no: plate,
        model: formValue(form, 'model'),
        vehicle_type: formValue(form, 'vehicle_type'),
        capacity: formValue(form, 'capacity'),
        status: formValue(form, 'status') || 'available'
      });
      await afterWrite(isEdit ? 'Vehicle updated.' : 'Vehicle added.');
    }
  });
}

// ---- Drivers -----------------------------------------------------------------

function renderDrivers() {
  const query = (document.getElementById('driver-search').value || '').toLowerCase();
  const list = drivers.filter((d) =>
    !query ||
    String(d.name || '').toLowerCase().includes(query) ||
    String(d.license_no || '').toLowerCase().includes(query));

  document.getElementById('drivers-body').innerHTML = list.length
    ? list.map((d) => `<tr>
        <td>${esc(d.name)}</td>
        <td>${esc(d.license_no || '—')}</td>
        <td>${esc(d.phone || '—')}</td>
        <td>${statusBadge(d.status)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${d.id}" type="button">Edit</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${d.id}" type="button">Delete</button>
        </td>
      </tr>`).join('')
    : emptyRow(5, 'No drivers yet. Add your first driver.');
}

async function onDriversClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const driver = drivers.find((d) => d.id === button.dataset.id);
  if (button.dataset.act === 'edit') {
    driverModal(driver);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog(`Delete driver "${driver ? driver.name : ''}"? Trips that reference them will show Unassigned.`, { title: 'Delete driver', okLabel: 'Delete' });
    if (!ok) return;
    await deleteRecord('drivers', button.dataset.id);
    await afterWrite('Driver deleted.');
  }
}

async function driverModal(driver) {
  const isEdit = !!driver;
  await openModal({
    title: isEdit ? 'Edit driver' : 'Add driver',
    submitLabel: isEdit ? 'Save changes' : 'Add driver',
    bodyHTML: `
      ${field({ label: 'Full name', name: 'name', value: driver ? driver.name : '', required: true, placeholder: 'e.g. John Kamau' })}
      <div class="field-row">
        ${field({ label: 'Licence number', name: 'license_no', value: driver ? driver.license_no : '', placeholder: 'DL-00000' })}
        ${field({ label: 'Phone', name: 'phone', type: 'tel', value: driver ? driver.phone : '', placeholder: '+254 7xx xxx xxx' })}
      </div>
      ${field({
        label: 'Status', name: 'status', value: driver ? driver.status : 'available',
        options: [
          { value: 'available', label: 'Available' },
          { value: 'on-trip', label: 'On trip' },
          { value: 'off-duty', label: 'Off duty' }
        ]
      })}
    `,
    onSubmit: async (form) => {
      const name = formValue(form, 'name');
      if (!name) throw new Error('Enter the driver name.');
      await saveRecord('drivers', {
        id: driver ? driver.id : undefined,
        created_at: driver ? driver.created_at : undefined,
        name,
        license_no: formValue(form, 'license_no'),
        phone: formValue(form, 'phone'),
        status: formValue(form, 'status') || 'available'
      });
      await afterWrite(isEdit ? 'Driver updated.' : 'Driver added.');
    }
  });
}

// ---- Trips / shipments ---------------------------------------------------------

function renderTrips() {
  document.getElementById('trips-body').innerHTML = trips.length
    ? trips.map((t) => `<tr>
        <td class="nowrap">${fmtDateTime(t.departure)}</td>
        <td>${esc(t.origin || '?')} &rarr; ${esc(t.destination || '?')}</td>
        <td>${esc(vehicleName(t.vehicle_id))}</td>
        <td>${esc(driverName(t.driver_id))}</td>
        <td>${esc(t.cargo || '—')}</td>
        <td>${statusBadge(t.status)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${t.id}" type="button">Edit</button>
          <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${t.id}" type="button">Delete</button>
        </td>
      </tr>`).join('')
    : emptyRow(7, 'No trips scheduled yet.');
}

async function onTripsClick(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const trip = trips.find((t) => t.id === button.dataset.id);
  if (button.dataset.act === 'edit') {
    tripModal(trip);
  } else if (button.dataset.act === 'delete') {
    const ok = await confirmDialog('Delete this trip / shipment record?', { title: 'Delete trip', okLabel: 'Delete' });
    if (!ok) return;
    await deleteRecord('trips', button.dataset.id);
    await afterWrite('Trip deleted.');
  }
}

async function tripModal(trip) {
  const isEdit = !!trip;
  const vehicleOptions = [{ value: '', label: '— choose vehicle —' }]
    .concat(vehicles.map((v) => ({ value: v.id, label: `${v.plate_no} (${v.model || v.vehicle_type || 'vehicle'})` })));
  const driverOptions = [{ value: '', label: '— choose driver —' }]
    .concat(drivers.map((d) => ({ value: d.id, label: d.name })));

  await openModal({
    title: isEdit ? 'Edit trip' : 'Schedule trip',
    submitLabel: isEdit ? 'Save changes' : 'Schedule trip',
    wide: true,
    bodyHTML: `
      <div class="field-row">
        ${field({ label: 'From (origin)', name: 'origin', value: trip ? trip.origin : '', required: true, placeholder: 'Nairobi' })}
        ${field({ label: 'To (destination)', name: 'destination', value: trip ? trip.destination : '', required: true, placeholder: 'Mombasa' })}
      </div>
      <div class="field-row">
        ${field({ label: 'Vehicle', name: 'vehicle_id', value: trip ? trip.vehicle_id : '', options: vehicleOptions })}
        ${field({ label: 'Driver', name: 'driver_id', value: trip ? trip.driver_id : '', options: driverOptions })}
      </div>
      <div class="field-row">
        ${field({ label: 'Departure', name: 'departure', type: 'datetime-local', value: toDatetimeLocal(trip ? trip.departure : Date.now()) })}
        ${field({ label: 'Arrival (optional)', name: 'arrival', type: 'datetime-local', value: toDatetimeLocal(trip ? trip.arrival : 0) })}
      </div>
      ${field({ label: 'Cargo / passengers', name: 'cargo', value: trip ? trip.cargo : '', placeholder: 'e.g. General shop supplies' })}
      ${field({
        label: 'Status', name: 'status', value: trip ? trip.status : 'scheduled',
        options: [
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'ongoing', label: 'Ongoing' },
          { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' }
        ]
      })}
    `,
    onSubmit: async (form) => {
      const origin = formValue(form, 'origin');
      const destination = formValue(form, 'destination');
      if (!origin || !destination) throw new Error('Enter both origin and destination.');
      await saveRecord('trips', {
        id: trip ? trip.id : undefined,
        created_at: trip ? trip.created_at : undefined,
        origin,
        destination,
        vehicle_id: formValue(form, 'vehicle_id'),
        driver_id: formValue(form, 'driver_id'),
        departure: fromDatetimeLocal(formValue(form, 'departure')),
        arrival: fromDatetimeLocal(formValue(form, 'arrival')),
        cargo: formValue(form, 'cargo'),
        status: formValue(form, 'status') || 'scheduled'
      });
      await afterWrite(isEdit ? 'Trip updated.' : 'Trip scheduled.');
    }
  });
}
