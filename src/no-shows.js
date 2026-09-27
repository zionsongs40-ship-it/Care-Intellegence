function isNoShowDue(appointment, now = new Date(), graceMinutes = 15) {
  if (!appointment || appointment.attended || appointment.checkedIn) return false;
  if (typeof appointment.date !== 'string' || typeof appointment.timeSlot !== 'string') return false;
  if (appointment.timeSlot.startsWith('Immediate') || !/^\d{2}:\d{2}$/.test(appointment.timeSlot)) return false;
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) return false;

  const scheduledAt = new Date(`${appointment.date}T${appointment.timeSlot}:00`);
  const [year, month, day] = appointment.date.split('-').map(Number);
  const [hours, minutes] = appointment.timeSlot.split(':').map(Number);
  if (Number.isNaN(scheduledAt.getTime())
      || scheduledAt.getFullYear() !== year
      || scheduledAt.getMonth() !== month - 1
      || scheduledAt.getDate() !== day
      || scheduledAt.getHours() !== hours
      || scheduledAt.getMinutes() !== minutes) return false;
  return now.getTime() - scheduledAt.getTime() >= graceMinutes * 60000;
}

module.exports = { isNoShowDue };
