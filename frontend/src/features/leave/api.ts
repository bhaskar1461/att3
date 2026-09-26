// TODO-REAL: backend leave api (GET /api/v1/leave/requests, POST /api/v1/leave/requests/{id}/action)
import { LeaveRequest, LeaveAction } from './schemas';

// In-memory mock storage for leave requests
let leaveStore: LeaveRequest[] = [
  {
    id: 'LEAVE-101',
    student_name: 'Bhaskar Sharma',
    roll_number: '23311A0525',
    department: 'CSE',
    start_date: '2026-09-28',
    end_date: '2026-09-30',
    reason: 'Medical observation following fever',
    status: 'pending',
    created_at: '2026-09-26T09:00:00Z',
  },
  {
    id: 'LEAVE-102',
    student_name: 'Kavya Reddy',
    roll_number: '23311A0526',
    department: 'CSE',
    start_date: '2026-09-29',
    end_date: '2026-09-29',
    reason: 'Family ceremony attendance',
    status: 'pending',
    created_at: '2026-09-26T10:15:00Z',
  },
  {
    id: 'LEAVE-100',
    student_name: 'Anil Kumar',
    roll_number: '23311A0501',
    department: 'ECE',
    start_date: '2026-09-20',
    end_date: '2026-09-22',
    reason: 'Inter-collegiate sports tournament',
    status: 'approved',
    created_at: '2026-09-19T14:30:00Z',
  },
];

export const leaveApi = {
  // TODO-REAL: Replace with apiClient.get('/api/v1/leave/requests')
  fetchLeaveRequests: async (): Promise<LeaveRequest[]> => {
    await new Promise((res) => setTimeout(res, 80));
    return [...leaveStore];
  },

  // TODO-REAL: Replace with apiClient.post(`/api/v1/leave/requests/${payload.id}/${payload.action}`)
  actOnLeaveRequest: async (payload: LeaveAction): Promise<LeaveRequest> => {
    await new Promise((res) => setTimeout(res, 120));
    const target = leaveStore.find((r) => r.id === payload.id);
    if (!target) {
      throw new Error(`Leave request ${payload.id} not found`);
    }
    target.status = payload.action === 'approve' ? 'approved' : 'rejected';
    return { ...target };
  },
};
