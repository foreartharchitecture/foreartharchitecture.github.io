// Firm configuration shared by the API. Keep in sync with CFG in the dashboard.

// Saved Notion views the dashboard reads, recreated as Notion API queries.
// Status groups are expressed as "not complete" so new in-progress options keep showing.
export const VIEWS = {
  'view://395eac43-053f-80bf-aea4-000cec07b988': {
    key: 'projects', ds: '1ceeac43-053f-80e7-a2d0-000bec1e0365',
    sorts: [{ property: 'Created', direction: 'ascending' }]
  },
  'view://245eac43-053f-8030-9aab-000c98f18d7b': {
    key: 'tasks', ds: '1ceeac43-053f-80b6-b099-000b73589415',
    filter: { and: [{ property: 'Status', status: { does_not_equal: 'Done' } }, { property: 'Status', status: { does_not_equal: 'Archive' } }] },
    sorts: [{ property: 'Task Range', direction: 'ascending' }]
  },
  'view://369eac43-053f-80b2-877d-000c26095248': {
    key: 'follow', ds: '1ceeac43-053f-80b6-b099-000b73589415',
    filter: { or: [{ property: 'Follow- Up Status', select: { equals: 'Awaiting Comments' } }, { property: 'Follow- Up Status', select: { equals: 'Comments processing' } }] }
  },
  'view://34beac43-053f-80e0-85ac-000cf8cb1409': {
    key: 'done', ds: '1ceeac43-053f-80b6-b099-000b73589415',
    filter: { property: 'Status', status: { equals: 'Done' } },
    sorts: [{ property: 'Done', direction: 'descending' }]
  },
  'view://35eeac43-053f-8012-9fbb-000c142cad44': { key: 'visits', ds: '35eeac43-053f-805d-80f0-000b48cd1c91' },
  'view://35ceac43-053f-8051-97f5-000cacd0dbe9': {
    key: 'meetings', ds: '35ceac43-053f-802b-839c-000bb3d13cd0',
    sorts: [{ property: 'Meeting Mode', direction: 'ascending' }]
  },
  'view://39feac43-053f-8049-ba4a-000c181645da': { key: 'team', ds: '1ceeac43-053f-8079-901e-000bd426820c' },
  'view://351eac43-053f-8086-bb13-000c1b4a22eb': { key: 'crm', ds: '351eac43-053f-8056-86b6-000b9ddf6710' },
  'view://269eac43-053f-80ec-b165-000c9953c798': { key: 'clients', ds: '269eac43-053f-807f-8f9c-000b651cea7a' },
  'view://35eeac43-053f-8068-9c0a-000c490afa8a': {
    key: 'issues', ds: '35eeac43-053f-806b-a28e-000bed55075a',
    filter: { and: [{ property: 'Status', status: { does_not_equal: 'Resolved' } }, { property: 'Status', status: { does_not_equal: 'Archived' } }] }
  }
};

// Data sources the dashboard may create records in.
export const WRITABLE_DS = {
  '1ceeac43-053f-80b6-b099-000b73589415': 'tasks',
  '35eeac43-053f-805d-80f0-000b48cd1c91': 'visits',
  '35ceac43-053f-802b-839c-000bb3d13cd0': 'meetings',
  '1ceeac43-053f-80e7-a2d0-000bec1e0365': 'projects',
  '269eac43-053f-807f-8f9c-000b651cea7a': 'clients',
  '351eac43-053f-8056-86b6-000b9ddf6710': 'crm'
};

// Never sent to the browser.
export const HIDDEN_PROPS = { team: ['Telegram Chat ID'] };
// Staff accounts receive only these properties (anything added to Notion later stays founder-only).
const TASK_FIELDS = ['Task ID', 'Name', 'Status', 'Priority', 'Projects', 'Assignee', 'Task Range', 'Delivery Commited', 'Done', 'Follow- Up Status', 'Follow up note', 'Last followup', 'Remarks', 'Last edited time', 'Created Time'];
export const STAFF_FIELDS = {
  projects: ['PROJECT ID', 'Name', 'Status', 'Stage', 'Priority', 'Project Type', 'Lead', 'Client', 'Location', 'Start- Expected End Date', 'Created'],
  tasks: TASK_FIELDS, follow: TASK_FIELDS, done: TASK_FIELDS,
  visits: ['SITE VISIT ID', 'Title', 'Project', 'Attendees', 'Purpose', 'Visit No', 'Date and Time', 'Site Visit report'],
  meetings: ['MEETING ID', 'Meeting Title', 'Project', 'Attending Staff', 'Meeting Mode', 'Location', 'Meeting Number', 'Date and Time', 'MoM'],
  team: ['MEMBER ID', 'Name', 'Role'],
  issues: ['Issue', 'Status', 'Project', 'Date identified']
};

// Google Drive folders. Staff may only open files inside the Studio tree.
export const DRIVE = {
  studio: '1Q51mpfCGt7qeOSoa5NckqMjWOsIRvMV7',
  ongoing: '1oy6y9ahlBETlVHQCVKs5z3BKHoduKmqz',
  completed: '1fUNVy0vy3kp-P08pifTD_LH9VsrjWRah',
  outbox: '12qr32I9yYrmsiyoKn-VPNM6ZPQStm-y4',
  finance: '1c4q_qdcYcPQkObWOr8AIVcBUEzp4gNwT',
  sales: '1WYkTfX_nxWNHvEPNKMmLx4-5OHPvmOJM',
  hr: '1fdgGBEUTvGTShqSVWgV3HUSu6qYgZ5aA'
};
export const STAFF_DRIVE_ROOTS = [DRIVE.studio, DRIVE.ongoing, DRIVE.completed, DRIVE.outbox];

// Access levels. Founders see everything; staff get a read-only Studio view.
export const ROLES = {
  founder: {
    label: 'Founder', groups: ['overview', 'studio', 'crm', 'sales', 'finance', 'hr'], home: 'overview',
    views: '*', write: true, search: true, ai: true, drive: 'all', admin: true
  },
  staff: {
    label: 'Staff', groups: ['studio'], home: 'studio-ov',
    views: ['projects', 'tasks', 'follow', 'done', 'visits', 'meetings', 'team', 'issues'],
    write: false, search: false, ai: false, drive: 'studio', admin: false
  }
};
export const roleOf = r => ROLES[r] || ROLES.staff;

export const AI_MODELS = { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' };
