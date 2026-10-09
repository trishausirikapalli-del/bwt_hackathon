// Comprehensive Automated End-to-End Test Suite for Employee Task Management System
const BASE_URL = 'http://localhost:5000/api';

async function request(endpoint, options = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.arrayBuffer();

  return { status: response.status, ok: response.ok, data, headers: response.headers };
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING AUTOMATED ACCEPTANCE TESTS FOR TASK MASTER');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const health = await request('/health');
    assert(health.status === 200 && health.data.database === 'connected', 'Database is healthy and live');

    // 2. Setup status check (should be required if db is empty)
    const setupStatus = await request('/auth/setup-status');
    assert(setupStatus.status === 200, 'Checked setup status endpoint');

    let adminToken;
    if (setupStatus.data.isSetupRequired) {
      console.log('\n--- Initializing First Admin ---');
      const adminSetup = await request('/auth/setup-admin', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Alexander Wright',
          email: 'admin@techcorp.com',
          password: 'Password@123',
        }),
      });
      assert(adminSetup.status === 201 && adminSetup.data.token, 'First administrator initialized securely');
      adminToken = adminSetup.data.token;

      // 3. Try setting up second admin (must be blocked!)
      const secondSetup = await request('/auth/setup-admin', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Hacker Admin',
          email: 'hacker@techcorp.com',
          password: 'Password@123',
        }),
      });
      assert(secondSetup.status === 403, 'Subsequent admin setup blocked with 403 Forbidden');
    } else {
      // Login as admin
      const adminLogin = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'admin@techcorp.com',
          password: 'Password@123',
        }),
      });
      assert(adminLogin.status === 200 && adminLogin.data.token, 'Admin logged in successfully');
      adminToken = adminLogin.data.token;
    }

    // 4. Admin Dashboard check
    console.log('\n--- Checking Initial Admin Dashboard ---');
    const adminDash = await request('/dashboard/summary', {}, adminToken);
    assert(adminDash.status === 200 && adminDash.data.role === 'admin', 'Admin dashboard retrieved with real DB aggregates');
    assert(typeof adminDash.data.counts.totalEmployees === 'number', `Total employees in DB: ${adminDash.data.counts.totalEmployees}`);
    assert(typeof adminDash.data.counts.totalTasks === 'number', `Total tasks in DB: ${adminDash.data.counts.totalTasks}`);

    // 5. Test Invalid Employee Validations
    console.log('\n--- Testing Employee Validation Rules ---');
    const invalidEmailEmp = await request('/employees', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'EMP-999',
        fullName: 'Test User',
        email: 'invalid-email-format',
        department: 'Engineering',
        designation: 'Engineer',
        joiningDate: '2026-01-01',
      }),
    }, adminToken);
    assert(invalidEmailEmp.status === 400, 'Rejected employee with invalid email format');

    const emptyNameEmp = await request('/employees', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'EMP-999',
        fullName: '   ',
        email: 'valid@company.com',
        department: 'Engineering',
        designation: 'Engineer',
        joiningDate: '2026-01-01',
      }),
    }, adminToken);
    assert(emptyNameEmp.status === 400, 'Rejected employee with empty name');

    // 6. Create Employee: Sarah Connor
    console.log('\n--- Registering Employees ---');
    const createEmp1 = await request('/employees', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'EMP-101',
        fullName: 'Sarah Connor',
        email: 'sarah@techcorp.com',
        department: 'Engineering',
        designation: 'Senior Frontend Engineer',
        joiningDate: '2026-01-15',
        role: 'employee',
        initialPassword: 'Password@123',
      }),
    }, adminToken);
    
    let sarahId = createEmp1.data.employee?._id;
    if (createEmp1.status === 201) {
      assert(true, 'Created employee Sarah Connor (EMP-101)');
    } else {
      // Find existing
      const list = await request('/employees?search=Sarah', {}, adminToken);
      sarahId = list.data.employees[0]?._id;
      assert(!!sarahId, 'Found existing Sarah Connor');
    }

    // 7. Duplicate Employee ID check
    const dupIdEmp = await request('/employees', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'EMP-101',
        fullName: 'Duplicate Employee',
        email: 'different@techcorp.com',
        department: 'Engineering',
        designation: 'Engineer',
        joiningDate: '2026-01-15',
      }),
    }, adminToken);
    assert(dupIdEmp.status === 400, 'Rejected duplicate employee ID with 400 Bad Request');

    // 8. Create Manager: David Miller
    const createEmp2 = await request('/employees', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'EMP-102',
        fullName: 'David Miller',
        email: 'david@techcorp.com',
        department: 'Engineering',
        designation: 'Engineering Manager',
        joiningDate: '2025-06-01',
        role: 'manager',
        initialPassword: 'Password@123',
      }),
    }, adminToken);
    if (createEmp2.status === 201) {
      assert(true, 'Created Manager David Miller (EMP-102)');
    } else {
      assert(createEmp2.status === 400 || createEmp2.status === 200, 'Manager David Miller registered');
    }

    // 9. Login as Manager David Miller
    console.log('\n--- Testing Manager Authentication & Task Assignment ---');
    const mgrLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'david@techcorp.com',
        password: 'Password@123',
      }),
    });
    assert(mgrLogin.status === 200 && mgrLogin.data.user.role === 'manager', 'Manager David Miller logged in successfully');
    const mgrToken = mgrLogin.data.token;

    // 10. Manager creates Task for Sarah Connor
    const taskDeadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const createTaskRes = await request('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        taskId: 'TSK-1001',
        title: 'Implement Core Security Middleware',
        description: 'Configure JWT session tokens and bcrypt password verification.',
        assignedEmployee: sarahId,
        priority: 'High',
        deadline: taskDeadline,
      }),
    }, mgrToken);
    let taskId = createTaskRes.data.task?._id;
    if (createTaskRes.status === 201) {
      assert(true, 'Manager assigned task TSK-1001 to Sarah Connor');
    } else {
      const allTasks = await request('/tasks?search=Security', {}, mgrToken);
      taskId = allTasks.data.tasks[0]?._id;
      assert(!!taskId, 'Task TSK-1001 found in database');
    }

    // 11. Login as Employee Sarah Connor
    console.log('\n--- Testing Employee Work View & Progress Tracking ---');
    const empLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'sarah@techcorp.com',
        password: 'Password@123',
      }),
    });
    assert(empLogin.status === 200 && empLogin.data.user.role === 'employee', 'Employee Sarah Connor logged in');
    const empToken = empLogin.data.token;

    // 12. Employee checks notifications
    const empNotifs = await request('/notifications', {}, empToken);
    assert(empNotifs.status === 200, `Employee retrieved notifications (Count: ${empNotifs.data.notifications.length})`);

    // 13. Progress updates test: 0% -> 50% (In Progress) -> 100% (Completed)
    console.log('\n--- Testing Progress Calculations & Automatic Status ---');
    // Test invalid progress (<0 or >100)
    const invalidProg = await request(`/tasks/${taskId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ progress: 150 }),
    }, empToken);
    assert(invalidProg.status === 400, 'Rejected invalid progress 150%');

    // Valid progress: 50%
    const prog50 = await request(`/tasks/${taskId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ progress: 50, note: 'Halfway through tests.' }),
    }, empToken);
    assert(prog50.status === 200 && prog50.data.task.status === 'In Progress', 'Progress updated to 50% -> Auto Status is "In Progress"');

    // Valid progress: 100%
    const prog100 = await request(`/tasks/${taskId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ progress: 100, note: 'Feature complete and verified.' }),
    }, empToken);
    assert(prog100.status === 200 && prog100.data.task.status === 'Completed' && prog100.data.task.completionDate, 'Progress updated to 100% -> Auto Status is "Completed" with completionDate');

    // 14. Work History & Progress History Logs
    console.log('\n--- Verifying Work History & Progress Audit Collection ---');
    const historyRes = await request(`/employees/${sarahId}/work-history`, {}, empToken);
    assert(historyRes.status === 200 && historyRes.data.progressHistory.length >= 2, `ProgressHistory has ${historyRes.data.progressHistory.length} audit entries for this task`);

    // 15. Excel Reports Test
    console.log('\n--- Testing SheetJS Excel Report Exports ---');
    // Employee Excel Download
    const empExcel = await request(`/reports/employees/${sarahId}/work-history/excel`, {}, empToken);
    assert(empExcel.status === 200 && empExcel.headers.get('content-type').includes('spreadsheetml'), 'Downloaded genuine employee work history Excel (.xlsx) file');

    // Company Excel Download (Admin)
    const companyExcel = await request('/reports/company/excel', {}, adminToken);
    assert(companyExcel.status === 200 && companyExcel.headers.get('content-type').includes('spreadsheetml'), 'Downloaded genuine company-wide multi-sheet Excel (.xlsx) file');

    // Company Excel Download Attempt by Employee (Must be Forbidden 403!)
    const forbiddenReport = await request('/reports/company/excel', {}, empToken);
    assert(forbiddenReport.status === 403, 'Employee blocked from company-wide report with 403 Forbidden');

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
