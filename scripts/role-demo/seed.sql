-- Demo people for the role walk (throwaway database only): one zone manager, one hub manager, one rider with logins,
-- a few more riders, and one rider in another zone who must stay invisible to all three.
select tests.fixture(); select tests.hr_fixture();
insert into tests.ids values
 ('e_zonal', tests.active_employee('Karim Zonal', '101', tests.id('hub_a1'), '01711000101', '1010101010', 40000, tests.id('zonal_a'))),
 ('e_mgr',   tests.active_employee('Sohel Manager', '102', tests.id('hub_a1'), '01711000102', '1020101010', 25000, tests.id('hub_mgr'))),
 ('e_staff', tests.active_employee('Rahim Rider', '103', tests.id('hub_a1'), '01711000103', '1030101010', 15000, tests.id('rider_login'))),
 ('e_r2', tests.active_employee('Jamal Rider', '104', tests.id('hub_a1'), '01711000104', '1040101010')),
 ('e_r3', tests.active_employee('Kamal Rider', '105', tests.id('hub_a1'), '01711000105', '1050101010')),
 ('e_r4', tests.active_employee('Babul Rider', '106', tests.id('hub_a2'), '01711000106', '1060101010')),
 ('e_b1', tests.active_employee('Other Zone Rider', '201', tests.id('hub_b1'), '01711000201', '2010101010'));
select tests.grant_role(tests.id('rider_login'), 'rider', 'hub', null, tests.id('hub_a1'));
