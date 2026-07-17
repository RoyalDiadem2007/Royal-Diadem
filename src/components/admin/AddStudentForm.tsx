/**
 * Individual enrollment form (Spec §6.10 enrollment tools). Validation here
 * is UX only — the Edge Function re-validates everything at the trust
 * boundary.
 */
import { useState } from 'react';
import {
  createStudent,
  type CreateStudentInput,
  type IssuedCredentials,
} from '@/lib/adminStudents';

type Props = {
  sessionToken: string;
  onEnrolled: (issued: IssuedCredentials) => void;
  onCancel: () => void;
};

const GENERIC_ERROR = 'Couldn’t enroll the student. Check the details and try again.';

export function AddStudentForm({ sessionToken, onEnrolled, onCancel }: Props) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [phase, setPhase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit =
    !submitting &&
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    displayName.trim() !== '' &&
    dateOfBirth !== '';

  function handleSubmit(): void {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError('');
    const input: CreateStudentInput = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      displayName: displayName.trim(),
      dateOfBirth,
    };
    if (gradeLevel.trim() !== '') {
      input.gradeLevel = gradeLevel.trim();
    }
    if (schoolName.trim() !== '') {
      input.schoolName = schoolName.trim();
    }
    if (phase.trim() !== '') {
      input.phase = phase.trim();
    }
    void createStudent(sessionToken, input).then((result) => {
      setSubmitting(false);
      if (result.ok) {
        onEnrolled(result.data);
      } else {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <form
      className="add-student-form"
      aria-label="Add student"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
      <h3 className="admin-subsection-title">Add a student</h3>
      <div className="add-student-grid">
        <label>
          <span>First name</span>
          <input
            type="text"
            value={firstName}
            maxLength={100}
            onChange={(e) => {
              setFirstName(e.target.value);
            }}
            required
          />
        </label>
        <label>
          <span>Last name</span>
          <input
            type="text"
            value={lastName}
            maxLength={100}
            onChange={(e) => {
              setLastName(e.target.value);
            }}
            required
          />
        </label>
        <label>
          <span>Display name</span>
          <input
            type="text"
            value={displayName}
            maxLength={100}
            onChange={(e) => {
              setDisplayName(e.target.value);
            }}
            required
          />
        </label>
        <label>
          <span>Date of birth</span>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => {
              setDateOfBirth(e.target.value);
            }}
            required
          />
        </label>
        <label>
          <span>Grade level (optional)</span>
          <input
            type="text"
            value={gradeLevel}
            maxLength={100}
            onChange={(e) => {
              setGradeLevel(e.target.value);
            }}
          />
        </label>
        <label>
          <span>School (optional)</span>
          <input
            type="text"
            value={schoolName}
            maxLength={100}
            onChange={(e) => {
              setSchoolName(e.target.value);
            }}
          />
        </label>
        <label>
          <span>Phase (optional)</span>
          <input
            type="text"
            value={phase}
            maxLength={100}
            onChange={(e) => {
              setPhase(e.target.value);
            }}
          />
        </label>
      </div>
      {error !== '' && (
        <p className="admin-section-note" role="alert">
          {error}
        </p>
      )}
      <div className="add-student-actions">
        <button type="submit" className="admin-retry-button" disabled={!canSubmit}>
          {submitting ? 'Enrolling…' : 'Enroll student'}
        </button>
        <button type="button" className="logout-button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
