import { useQuery } from '@tanstack/react-query';
import { keys } from '../../core/api/keys';
import { rosterEndpoints } from '../../core/api/endpoints/roster';

export const useDepartmentsQuery = () => {
  return useQuery({
    queryKey: keys.roster.departments(),
    queryFn: rosterEndpoints.listDepartments,
  });
};

export const useSectionsQuery = () => {
  return useQuery({
    queryKey: keys.roster.sections(),
    queryFn: rosterEndpoints.listSections,
  });
};

export const useSubjectsQuery = () => {
  return useQuery({
    queryKey: keys.roster.subjects(),
    queryFn: rosterEndpoints.listSubjects,
  });
};
