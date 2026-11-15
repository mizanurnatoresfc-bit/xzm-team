-- ID-ready profiles: one check for old and new employees, by the ID-create format.
begin;
select tests.fixture();
select tests.hr_fixture();

select tests.ok(exists (select 1 from public.employee_custom_fields where code = 'alt_mobile' and is_required)
            and exists (select 1 from public.employee_custom_fields where code = 'blood_group' and is_required),
  'alternative mobile and blood group are required profile fields');
select tests.ok((select count(*) from public.pay_component_types where code in ('pick_drop','return_bonus','weight_bonus','entry_commission')) = 4,
  'the format''s pay items exist');

-- a bare employee lacks the format's information
create temp table bare as
  with x as (insert into public.employees (full_name, status) values ('Bare Applicant', 'applicant') returning id) select id from x;
select tests.ok((select private.hr_id_gaps(b.id) @> array['mobile','hub','position','date_of_birth','permanent_address','nid_number','reference',
                        'basic_salary','document:photo','document:nid_front','document:nid_back','field:alt_mobile','field:blood_group']
                 from bare b),
  'a profile without the format''s information shows each missing item');

-- the report lists people the caller may see, with what is missing
select tests.login(tests.id('hr'));
select tests.ok((select count(*) > 0 and bool_and(total_checks >= 14) from public.hr_profile_gaps()),
  'HR sees every profile with its missing items');
select tests.logout();
select tests.ok(not exists (select 1 from public.hr_missing_information() m where m.missing is distinct from private.hr_id_gaps(m.employee_id)),
  'the HR dashboard counts the same gaps');

-- positions: old spellings still match imports
select tests.ok(private.norm_name('Asst. Manager') = 'asstmanager' and private.norm_name(' Shorting+Loader ') = 'shortingloader',
  'names are compared without spaces and dots');
rollback;
